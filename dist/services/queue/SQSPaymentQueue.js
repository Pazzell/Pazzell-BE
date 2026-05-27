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
exports.SQSPaymentQueue = void 0;
const client_sqs_1 = require("@aws-sdk/client-sqs");
const awsClients_1 = require("../../aws/awsClients");
class SQSPaymentQueue {
    constructor() {
        this.queueUrl = process.env.AWS_SQS_PAYMENT_QUEUE_URL;
    }
    isEnabled() {
        return true;
    }
    enqueue(payload) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const result = yield (0, awsClients_1.getSQSClient)().send(new client_sqs_1.SendMessageCommand({
                    QueueUrl: this.queueUrl,
                    MessageBody: JSON.stringify(payload),
                    MessageGroupId: payload.campaignId, // for FIFO; ignored by Standard queues
                }));
                return { success: true, messageId: result.MessageId };
            }
            catch (err) {
                console.error("SQS enqueue error:", err);
                return { success: false };
            }
        });
    }
    dequeue(maxMessages, handler) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield (0, awsClients_1.getSQSClient)().send(new client_sqs_1.ReceiveMessageCommand({
                QueueUrl: this.queueUrl,
                MaxNumberOfMessages: Math.min(maxMessages, 10),
                WaitTimeSeconds: 5,
            }));
            if (!result.Messages)
                return;
            for (const msg of result.Messages) {
                if (!msg.Body || !msg.ReceiptHandle)
                    continue;
                try {
                    const payload = JSON.parse(msg.Body);
                    yield handler(payload);
                    yield (0, awsClients_1.getSQSClient)().send(new client_sqs_1.DeleteMessageCommand({
                        QueueUrl: this.queueUrl,
                        ReceiptHandle: msg.ReceiptHandle,
                    }));
                }
                catch (err) {
                    console.error("SQS message processing error:", err);
                }
            }
        });
    }
}
exports.SQSPaymentQueue = SQSPaymentQueue;
