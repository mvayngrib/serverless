'use strict';

const _ = require('lodash');

const stripLineBreaks = str => str.replace(/\r?\n/g, '');

class AwsCompileIoTEvents {
  constructor(serverless) {
    this.serverless = serverless;
    this.provider = this.serverless.getProvider('aws');

    this.hooks = {
      'package:compileEvents': this.compileIoTEvents.bind(this),
    };
  }

  compileIoTEvents() {
    this.serverless.service.getAllFunctions().forEach((functionName) => {
      const functionObj = this.serverless.service.getFunction(functionName);
      let iotNumberInFunction = 0;

      if (!functionObj.events) return;

      functionObj.events.forEach(event => {
        if (!event.iot) return;

        const { iot } = event;
        iotNumberInFunction++;
        let RuleName;
        let AwsIotSqlVersion;
        let Description;
        let RuleDisabled;
        let Sql;

        if (typeof iot === 'object') {
          const { name, sqlVersion, description, enabled, sql } = iot
          RuleName = name;
          AwsIotSqlVersion = sqlVersion;
          Description = description;
          RuleDisabled = false;
          if (enabled === false) {
            RuleDisabled = true;
          }
          Sql = sql;
          if (typeof Sql === 'string') {
            Sql = `"${stripLineBreaks(Sql)}"`;
          } else {
            // SQL may be built with intrinsic functions
            Sql = JSON.stringify(Sql, null, 2);
          }
        } else {
          const errorMessage = [
            `IoT event of function "${functionName}" is not an object`,
            ' Please check the docs for more info.',
          ].join('');
          throw new this.serverless.classes
            .Error(errorMessage);
        }

        const lambdaLogicalId = this.provider.naming
          .getLambdaLogicalId(functionName);
        const iotLogicalId = this.provider.naming
          .getIotLogicalId(functionName, iotNumberInFunction);
        const lambdaPermissionLogicalId = this.provider.naming
          .getLambdaIotPermissionLogicalId(functionName, iotNumberInFunction);
        const iotTemplate = `
          {
            "Type": "AWS::IoT::TopicRule",
            "Properties": {
              ${RuleName ? `"RuleName": "${stripLineBreaks(RuleName)}",` : ''}
              "TopicRulePayload": {
                ${AwsIotSqlVersion ? `"AwsIotSqlVersion":
                  "${stripLineBreaks(AwsIotSqlVersion)}",` : ''}
                ${Description ? `"Description": "${stripLineBreaks(Description)}",` : ''}
                "RuleDisabled": "${RuleDisabled}",
                "Sql": ${Sql},
                "Actions": [
                  {
                    "Lambda": {
                      "FunctionArn": { "Fn::GetAtt": ["${lambdaLogicalId}", "Arn"] }
                    }
                  }
                ]
              }
            }
          }
        `;

        const permissionTemplate = `
          {
            "Type": "AWS::Lambda::Permission",
            "Properties": {
              "FunctionName": { "Fn::GetAtt": ["${lambdaLogicalId}", "Arn"] },
              "Action": "lambda:InvokeFunction",
              "Principal": "iot.amazonaws.com",
              "SourceArn": { "Fn::Join": ["",
                [
                  "arn:aws:iot:",
                  { "Ref": "AWS::Region" },
                  ":",
                  { "Ref": "AWS::AccountId" },
                  ":rule/",
                  { "Ref": "${iotLogicalId}"}
                ]
              ] }
            }
          }
        `;

        const newIotObject = {
          [iotLogicalId]: JSON.parse(iotTemplate),
        };

        const newPermissionObject = {
          [lambdaPermissionLogicalId]: JSON.parse(permissionTemplate),
        };

        _.merge(this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
          newIotObject, newPermissionObject);
      });
    });
  }
}
module.exports = AwsCompileIoTEvents;
