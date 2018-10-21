'use strict';

const _ = require('lodash');
const stripLineBreaks = str => str.replace(/\r?\n/g, '');

class AwsCompileCloudWatchLogEvents {
  constructor(serverless) {
    this.serverless = serverless;
    this.provider = this.serverless.getProvider('aws');

    this.hooks = {
      'package:compileEvents': this.compileCloudWatchLogEvents.bind(this),
    };
  }

  compileCloudWatchLogEvents() {
    const logGroupNames = [];

    this.serverless.service.getAllFunctions().forEach((functionName) => {
      const functionObj = this.serverless.service.getFunction(functionName);
      let cloudWatchLogNumberInFunction = 0;

      if (!functionObj.events) return;

      functionObj.events.forEach(event => {
        if (!event.cloudwatchLog) return;

        const { cloudwatchLog } = event;

        cloudWatchLogNumberInFunction++;
        let LogGroupName;
        let FilterPattern;

        if (typeof cloudwatchLog === 'object') {
          const { logGroup, filter } = cloudwatchLog;
          if (!logGroup) {
            const errorMessage = [
              'Missing "logGroup" property for cloudwatchLog event ',
              `in function ${functionName} Please check the docs for more info.`,
            ].join('');
            throw new this.serverless.classes
              .Error(errorMessage);
          }

          if (filter && typeof filter !== 'string') {
            const errorMessage = [
              `"filter" property for cloudwatchLog event in function ${functionName} `,
              'should be string. Please check the docs for more info.',
            ].join('');
            throw new this.serverless.classes
              .Error(errorMessage);
          }

          LogGroupName = stripLineBreaks(logGroup);
          FilterPattern = filter ? stripLineBreaks(filter) : '';
        } else if (typeof cloudwatchLog === 'string') {
          LogGroupName = stripLineBreaks(cloudwatchLog);
          FilterPattern = '';
        } else {
          const errorMessage = [
            `cloudwatchLog event of function "${functionName}" is not an object or a string`,
            ' Please check the docs for more info.',
          ].join('');
          throw new this.serverless.classes
            .Error(errorMessage);
        }

        if (_.indexOf(logGroupNames, LogGroupName) !== -1) {
          const errorMessage = [
            `"${LogGroupName}" logGroup for cloudwatchLog event is duplicated.`,
            ' This property can only be set once per CloudFormation stack.',
          ].join('');
          throw new this.serverless.classes
            .Error(errorMessage);
        }
        logGroupNames.push(LogGroupName);

        const lambdaLogicalId = this.provider.naming
          .getLambdaLogicalId(functionName);
        const cloudWatchLogLogicalId = this.provider.naming
          .getCloudWatchLogLogicalId(functionName, cloudWatchLogNumberInFunction);
        const lambdaPermissionLogicalId = this.provider.naming
          .getLambdaCloudWatchLogPermissionLogicalId(functionName,
            cloudWatchLogNumberInFunction);

        const cloudWatchLogRuleTemplate = `
          {
            "Type": "AWS::Logs::SubscriptionFilter",
            "DependsOn": "${lambdaPermissionLogicalId}",
            "Properties": {
              "LogGroupName": "${LogGroupName}",
              "FilterPattern": "${FilterPattern}",
              "DestinationArn": { "Fn::GetAtt": ["${lambdaLogicalId}", "Arn"] }
            }
          }
        `;

        const permissionTemplate = `
          {
            "Type": "AWS::Lambda::Permission",
            "Properties": {
              "FunctionName": { "Fn::GetAtt": ["${
          lambdaLogicalId}", "Arn"] },
              "Action": "lambda:InvokeFunction",
              "Principal": {
                "Fn::Join": [ "", [
                "logs.",
                { "Ref": "AWS::Region" },
                ".amazonaws.com"
                ] ]
              },
              "SourceArn": {
                "Fn::Join": [ "", [
                "arn:aws:logs:",
                { "Ref": "AWS::Region" },
                ":",
                { "Ref": "AWS::AccountId" },
                ":log-group:",
                "${LogGroupName}",
                ":*"
                ] ]
              }
            }
          }
        `;

        const newCloudWatchLogRuleObject = {
          [cloudWatchLogLogicalId]: JSON.parse(cloudWatchLogRuleTemplate),
        };

        const newPermissionObject = {
          [lambdaPermissionLogicalId]: JSON.parse(permissionTemplate),
        };

        _.merge(this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
          newCloudWatchLogRuleObject, newPermissionObject);
      });
    });
  }
}

module.exports = AwsCompileCloudWatchLogEvents;
