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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESEmailService = void 0;
const client_ses_1 = require("@aws-sdk/client-ses");
const ejs_1 = __importDefault(require("ejs"));
const path_1 = __importDefault(require("path"));
const awsClients_1 = require("../../aws/awsClients");
class SESEmailService {
    constructor() {
        this.fromEmail = process.env.AWS_SES_FROM_EMAIL;
    }
    sendMail(options) {
        return __awaiter(this, void 0, void 0, function* () {
            const { email, subject, template, data } = options;
            const templatePath = path_1.default.join(__dirname, "../../mails", template);
            const html = yield ejs_1.default.renderFile(templatePath, data);
            yield (0, awsClients_1.getSESClient)().send(new client_ses_1.SendEmailCommand({
                Source: this.fromEmail,
                Destination: { ToAddresses: [email] },
                Message: {
                    Subject: { Data: subject, Charset: "UTF-8" },
                    Body: { Html: { Data: html, Charset: "UTF-8" } },
                },
            }));
        });
    }
}
exports.SESEmailService = SESEmailService;
