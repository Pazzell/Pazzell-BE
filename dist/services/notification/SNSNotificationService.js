"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SNSNotificationService = void 0;
const client_sns_1 = require("@aws-sdk/client-sns");
const awsClients_1 = require("../../aws/awsClients");
// Maps topicKey to environment variable holding the SNS Topic ARN
const TOPIC_ARN_MAP = {
    payment: process.env.AWS_SNS_PAYMENT_TOPIC_ARN,
    campaign: process.env.AWS_SNS_CAMPAIGN_TOPIC_ARN,
    general: process.env.AWS_SNS_PAYMENT_TOPIC_ARN, // fallback to payment topic
};
class SNSNotificationService {
    isEnabled() {
        return true;
    }
    publish(payload) {
        return __awaiter(this, void 0, void 0, function* () {
            const topicArn = TOPIC_ARN_MAP[payload.topicKey];
            if (!topicArn) {
                console.warn(`SNS topic ARN not configured for key: ${payload.topicKey}`);
                return;
            }
            const messageAttributes = {};
            if (payload.metadata) {
                for (const [k, v] of Object.entries(payload.metadata)) {
                    messageAttributes[k] = { DataType: "String", StringValue: v };
                }
            }
            yield (0, awsClients_1.getSNSClient)().send(new client_sns_1.PublishCommand({
                TopicArn: topicArn,
                Subject: payload.subject,
                Message: payload.message,
                MessageAttributes: messageAttributes,
            }));
        });
    }
}
exports.SNSNotificationService = SNSNotificationService;
