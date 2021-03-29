import * as cdk from '@aws-cdk/core';
import { Config } from '../config/config';
import { ApplicationLoadBalancerConstruct } from './alb-construct';
import { CiCdPipelineConstruct } from './cicd-pipeline-construct';
import { EcsFargateClusterConstruct } from './ecs-fargate-cluster-construct';
import { EcsFargateServiceConstruct } from './ecs-fargate-service-construct';
import { FargateAutoscalerConstruct } from './fargate-autoscaler-construct';
import { VpcConstruct } from './vpc-construct';
import { VpcNoNatConstruct } from './vpc-no-nat-construct';

/**
 * ECS-Fargate
 * 
 * VPC0: 0 NAT-Gateway, Public/Isolated Subnets ONLY
 * VPC1: 2 NAT-Gateway, Public/Private/Isolated Subnets
 * 
 * /web        ==> React.js Frontend 1      <-- fargateAutoscalerStack(Connection) + CodePineline 1
 * /crawl      ==> Crawl Node.js Backend 1  <-- fargateAutoscalerStack(RAM)        + CodePineline 2
 * /sync       ==> Sync  Node.js Backend 2  <-- fargateAutoscalerStack(RAM)        + CodePineline 2
 */
export class EcsFargateStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    /** Step 1. VpcConstruct: NAT-Gateway >= 1 */
    const vpc = new VpcConstruct(this, Config.vpcConstructId, {
      maxAzs:         Config.maxAzs,
      cidr:           Config.cidr,
      ports:          Config.publicPorts,
      natGateways:    Config.natGateways,
      useDefaultVpc:  Config.useDefaultVpc,
      vpcId:          Config.vpcId,
      useExistVpc:    Config.useExistVpc
    });

    /** Step 1*. VpcNoNatConstruct: NAT-Gateway == 0 */
    // const vpc = new VpcNoNatConstruct(this, Config.vpcConstructId, {
    //     maxAzs: Config.maxAzs,
    //     cidr: Config.cidr,
    //     ports: Config.publicPorts,
    //     natGateways: Config.natGateways,
    //     useDefaultVpc: Config.useDefaultVpc,
    //     vpcId: Config.vpcId,
    //     useExistVpc: Config.useExistVpc
    // });
    
    /** Step 2. Application Load Balancer */
    const applicationLoadBalancer = new ApplicationLoadBalancerConstruct(this,Config.loadBalancerConstructName,{
      listerPort:                  Config.listenerPort,
      publicLoadBalancer:          Config.publicLoadBalancer,
      vpc:                         vpc.vpc,
      securityGrp:                 vpc.securityGrp,
      route53HostedZone:           Config.route53HostedZone,
      route53HostedZoneRecordName: Config.route53HostedZoneRecordName,
      acmArn:                      Config.acmArn,
    })

    /** Step 3.1. ECS Cluster */
    const ecsFargateCluster = new EcsFargateClusterConstruct(this, Config.ecsClusterConstructName, {
      vpc:         vpc.vpc,
      // allowPort:   Config.TgrAllowPort,
      clusterName: Config.clusterName, 
      containerInsights:           true
    });

    /** Step 3.2. ECS Service & Task */
    const job4UWeb = new EcsFargateServiceConstruct(this,"Job4U-Web"+ Config.ecsServiceConstructName, {
      alb: applicationLoadBalancer.alb,
      vpc: vpc.vpc,
      loadBalancerListener: applicationLoadBalancer.loadBalancerListener,
      cluster:              ecsFargateCluster.cluster,
      codelocation:         Config.job4uwebCodeLocation,
      containerPort:        Config.containerPort,
      hostPort:             Config.TgrAllowPort,
      desiredCount:         Config.desiredCount,
      healthCheckPath:      Config.job4uwebHealthCheckPath,
      priority: 1,          /* => root path must have lowest priority */
      pathPattern:          Config.job4uwebPathPattern, 
      // noNatVpc:false /** => set to true if use VpcNoNatConstruct for service's vpc */
      noNatVpc:true     /** Provision the EcsFargateService in Public Subnet */
    });

    /** Step 4. CI/CD Pipeline */
    const job4UWebCicdPipeline = new CiCdPipelineConstruct(this,"Job4U-Web" + Config.CicdPipelineConstructId,{
        clusterName:    ecsFargateCluster.cluster.clusterName,
        ecsService:     job4UWeb.fgservice,
        containerName:  job4UWeb.containerName,
        dockerUsername: Config.dockerUsername,
        // dockerCredentialSecretArn: Config.dockerCredentialSecretArn,
        // runtimeEnv:                Config.runtimeEnv,
        s3artifact:     ecsFargateCluster.s3artifact,
        repoName:       Config.job4uwebRepoName
    });

    /** Step 5. ECS AutoScaler */
     const job4UWebAutoScaler = new FargateAutoscalerConstruct(this,"Job4U-Web"+Config.FargateAutoscalerConstructId,{
      cluster:   ecsFargateCluster.cluster,
      ecsService:job4UWeb.fgservice,  
      maxCapacity:      Config.maxCapacity,
      minCapacity:      Config.minCapacity,
      cpuTargetValue:   Config.cpuTargetValue,
      memoryTargetValue:Config.memoryTargetValue,
      scaleInCooldown:  Config.scaleInCooldown,
      scaleOutCooldown: Config.scaleOutCooldown,
      alb:              applicationLoadBalancer.alb,
      scaleOutAvgPeriod:Config.scaleOutAvgPeriod,
      scaleOutAvgNumber:Config.scaleOutAvgNumber,
      scaleInAvgPeriod: Config.scaleInAvgPeriod,
      scaleInAvgNumber: Config.scaleInAvgNumber
    });

  }
}
