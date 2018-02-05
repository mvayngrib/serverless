'use strict';

const fs = require('fs');
const BbPromise = require('bluebird');
const chalk = require('chalk');
const path = require('path');
const validate = require('../lib/validate');
const stdin = require('get-stdin');
const formatLambdaLogEvent = require('../utils/formatLambdaLogEvent');
const prettify = obj => JSON.stringify(obj, null, 4);

class AwsInvoke {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('aws');

    Object.assign(this, validate);

    this.hooks = {
      'invoke:invoke': () => BbPromise.bind(this)
        .then(this.extendedValidate)
        .then(this.invoke)
        .then(this.log),
    };
  }

  extendedValidate() {
    this.validate();

    // validate function exists in service
    this.options.functionObj = this.serverless.service.getFunction(this.options.function);
    this.options.data = this.options.data || '';

    return new BbPromise(resolve => {
      if (this.options.data) {
        resolve();
      } else if (this.options.path) {
        const absolutePath = path.isAbsolute(this.options.path) ?
          this.options.path :
          path.join(this.serverless.config.servicePath, this.options.path);
        if (!this.serverless.utils.fileExistsSync(absolutePath)) {
          throw new this.serverless.classes.Error('The file you provided does not exist.');
        }
        this.options.data = this.serverless.utils.readFileSync(absolutePath);
        resolve();
      } else {
        try {
          stdin().then(input => {
            this.options.data = input;
            resolve();
          });
        } catch (exception) {
          // resolve if no stdin was provided
          resolve();
        }
      }
    }).then(() => {
      try {
        if (!this.options.raw) {
          this.options.data = JSON.parse(this.options.data);
        }
      } catch (exception) {
        // do nothing if it's a simple string or object already
      }
    });
  }

  invoke() {
    const invocationType = this.options.type || 'RequestResponse';
    if (invocationType !== 'RequestResponse') {
      this.options.log = 'None';
    } else {
      this.options.log = this.options.log ? 'Tail' : 'None';
    }

    const params = {
      FunctionName: this.options.functionObj.name,
      InvocationType: invocationType,
      LogType: this.options.log,
      Payload: new Buffer(JSON.stringify(this.options.data || {})),
    };

    return this.provider
      .request('Lambda', 'invoke', params, this.options.stage, this.options.region);
  }

  log(invocationReply) {
    const {
      FunctionError,
      LogResult,
      Payload
    } = invocationReply

    const color = !FunctionError ? 'white' : 'red';
    const err = FunctionError ? FunctionError || Payload : null
    const res = err ? null : Payload && JSON.parse(Payload)
    if (err || res) {
      this.writeResponse(err, res)
    }

    if (LogResult) {
      this.consoleLog(chalk
        .gray('--------------------------------------------------------------------'));
      const logResult = new Buffer(LogResult, 'base64').toString();
      logResult.split('\n').forEach(line => this.consoleLog(formatLambdaLogEvent(line)));
    }

    if (invocationReply.FunctionError) {
      return BbPromise.reject(new Error('Invoked function failed'));
    }

    return BbPromise.resolve();
  }

  writeResponse(err, res) {
    const data = err || res
    const str = typeof data === 'string' ? data : prettify(data);
    const formatted = err ? chalk.red(str) : chalk.white(str)
    const file = this.options.output
    if (file) {
      fs.appendFileSync(file, formatted);
      return;
    }

    this.serverless.cli.consoleLog(str);
  }

  consoleLog(msg) {
    console.log(msg); // eslint-disable-line no-console
  }
}

module.exports = AwsInvoke;
