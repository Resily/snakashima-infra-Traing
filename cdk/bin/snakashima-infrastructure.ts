#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { SnakashimaInfrastructureStack } from "../lib/snakashima-infrastructure-stack";

const app = new cdk.App();
new SnakashimaInfrastructureStack(app, "SnakashimaInfrastructureStack", {
  /* 必要に応じてenvやpropsを指定 */
});
