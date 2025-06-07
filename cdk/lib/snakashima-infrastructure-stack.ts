import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export class SnakashimaInfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ====================================
    // 1. VPC and Networking
    // ====================================

    const vpc = new ec2.Vpc(this, "SnakashimaVpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      availabilityZones: ["ap-northeast-1a", "ap-northeast-1c"],
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      natGateways: 0, // コスト削減のためNAT Gatewayなし
    });

    // ====================================
    // 2. Security Groups
    // ====================================

    // ALB用セキュリティグループ
    const albSecurityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc: vpc,
      description: "Security group for ALB",
      allowAllOutbound: true,
    });

    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP from anywhere"
    );

    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS from anywhere"
    );

    // ECS用セキュリティグループ
    const ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc: vpc,
      description: "Security group for ECS tasks",
      allowAllOutbound: true,
    });

    ecsSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(80),
      "Allow HTTP from ALB"
    );

    // RDS用セキュリティグループ
    const rdsSecurityGroup = new ec2.SecurityGroup(this, "RdsSecurityGroup", {
      vpc: vpc,
      description: "Security group for RDS PostgreSQL",
      allowAllOutbound: false,
    });

    rdsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      "Allow PostgreSQL from ECS"
    );

    // Redis用セキュリティグループ
    const redisSecurityGroup = new ec2.SecurityGroup(
      this,
      "RedisSecurityGroup",
      {
        vpc: vpc,
        description: "Security group for ElastiCache Redis",
        allowAllOutbound: false,
      }
    );

    redisSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(6379),
      "Allow Redis from ECS"
    );

    // ====================================
    // 3. RDS (PostgreSQL 17)
    // ====================================

    const dbSubnetGroup = new rds.SubnetGroup(this, "DatabaseSubnetGroup", {
      vpc: vpc,
      description: "Subnet group for RDS database",
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
    });

    const database = new rds.DatabaseInstance(this, "PostgresDatabase", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_17,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      vpc: vpc,
      subnetGroup: dbSubnetGroup,
      securityGroups: [rdsSecurityGroup],
      credentials: rds.Credentials.fromGeneratedSecret("postgres", {
        secretName: "snakashima-db-credentials",
      }),
      databaseName: "snakashima",
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      deleteAutomatedBackups: true,
      backupRetention: cdk.Duration.days(0), // 学習用のため無効
      deletionProtection: false,
      publiclyAccessible: false,
    });

    // ====================================
    // 4. ElastiCache (Redis)
    // ====================================

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(
      this,
      "RedisSubnetGroup",
      {
        description: "Subnet group for ElastiCache Redis",
        subnetIds: vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }).subnetIds,
      }
    );

    const redisCluster = new elasticache.CfnCacheCluster(this, "RedisCluster", {
      cacheNodeType: "cache.t2.micro",
      engine: "redis",
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      port: 6379,
    });

    redisCluster.addDependency(redisSubnetGroup);

    // ====================================
    // 5. ECS Cluster and Service
    // ====================================

    const cluster = new ecs.Cluster(this, "EcsCluster", {
      vpc: vpc,
      clusterName: "snakashima-cluster",
    });

    // CloudWatch Logs Group
    const logGroup = new logs.LogGroup(this, "EcsLogGroup", {
      logGroupName: "/ecs/snakashima-app",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TaskDefinition",
      {
        memoryLimitMiB: 512,
        cpu: 256,
      }
    );

    const container = taskDefinition.addContainer("nginx", {
      image: ecs.ContainerImage.fromRegistry("nginx:latest"),
      memoryLimitMiB: 512,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "ecs",
        logGroup: logGroup,
      }),
      environment: {
        // 環境変数でDB/Redis接続情報を設定可能
        DB_HOST: database.instanceEndpoint.hostname,
        DB_PORT: "5432",
        DB_NAME: "snakashima",
        REDIS_HOST: redisCluster.attrRedisEndpointAddress,
        REDIS_PORT: "6379",
      },
    });

    container.addPortMappings({
      containerPort: 80,
      protocol: ecs.Protocol.TCP,
    });

    // ====================================
    // 6. Application Load Balancer
    // ====================================

    const alb = new elbv2.ApplicationLoadBalancer(
      this,
      "ApplicationLoadBalancer",
      {
        vpc: vpc,
        internetFacing: true,
        securityGroup: albSecurityGroup,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
      }
    );

    const targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
      vpc: vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        enabled: true,
        path: "/",
        protocol: elbv2.Protocol.HTTP,
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        timeout: cdk.Duration.seconds(5),
        interval: cdk.Duration.seconds(30),
      },
    });

    const listener = alb.addListener("Listener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // ====================================
    // 7. ECS Service
    // ====================================

    const ecsService = new ecs.FargateService(this, "EcsService", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      serviceName: "snakashima-service",
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC, // パブリックIPが必要
      },
      securityGroups: [ecsSecurityGroup],
      assignPublicIp: true, // パブリックIP割り当て
    });

    // ターゲットグループにECSサービスを登録
    ecsService.attachToApplicationTargetGroup(targetGroup);

    // ====================================
    // 8. Outputs
    // ====================================

    new cdk.CfnOutput(this, "LoadBalancerDNS", {
      value: alb.loadBalancerDnsName,
      description: "DNS name of the load balancer",
      exportName: "SnakashimaALBDNS",
    });

    new cdk.CfnOutput(this, "DatabaseEndpoint", {
      value: database.instanceEndpoint.hostname,
      description: "RDS PostgreSQL endpoint",
      exportName: "SnakashimaDBEndpoint",
    });

    new cdk.CfnOutput(this, "RedisEndpoint", {
      value: redisCluster.attrRedisEndpointAddress,
      description: "ElastiCache Redis endpoint",
      exportName: "SnakashimaRedisEndpoint",
    });

    new cdk.CfnOutput(this, "AccessURL", {
      value: `http://${alb.loadBalancerDnsName}`,
      description: "URL to access the application",
    });

    // ====================================
    // Tags for all resources
    // ====================================

    cdk.Tags.of(this).add("Project", "SnakashimaTraining");
    cdk.Tags.of(this).add("Environment", "Development");
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }
}
