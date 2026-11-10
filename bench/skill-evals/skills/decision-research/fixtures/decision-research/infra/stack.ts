import { Stack, aws_ec2 as ec2, aws_sns as sns } from 'aws-cdk-lib';
export class NotifyStack extends Stack {
  constructor(scope: any, id: string) {
    super(scope, id);
    const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2 });
    // One t3.small runs the cron worker. If it dies, jobs stop until someone notices.
    new ec2.Instance(this, 'CronWorker', { vpc, instanceType: new ec2.InstanceType('t3.small'), machineImage: ec2.MachineImage.latestAmazonLinux2023() });
    new sns.Topic(this, 'DigestTopic');
  }
}
