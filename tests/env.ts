// Runs before every test file (jest "setupFiles"), i.e. before dotenv loads .env.
// dotenv never overrides a variable that is already set, so the values below keep the
// suite away from every real service: no real database, gateway, storage, mail or AWS.
process.env.NODE_ENV = "test";
process.env.DB_URI = "";
process.env.REDIS_URL = "";
process.env.ACCESS_TOKEN = "testaccesssecret";
process.env.REFRESH_TOKEN = "testrefreshsecret";
process.env.ACTIVATION_SECRET = "testactivationsecret";
process.env.STORAGE_PROVIDER = "memory";
process.env.EMAIL_PROVIDER = "gmail";
process.env.SMTP_MAIL = "";
process.env.SMTP_PASSWORD = "";
process.env.SENDGRID_API_KEY = "";
process.env.NOTIFICATION_PROVIDER = "none";
process.env.TRANSFER_PROVIDER = "paystack";
process.env.PAYSTACK_SECRET_KEY = "sk_test_unit_tests_only";
process.env.FRONTEND_URL = "https://app.pazzell.test";
process.env.AWS_ACCESS_KEY_ID = "";
process.env.AWS_SECRET_ACCESS_KEY = "";
process.env.PAYMENT_CURRENCY = "NGN";
process.env.PRO_PRICE_AMOUNT = "1500";
process.env.PRO_DURATION_DAYS = "30";
process.env.CAMPAIGN_PRICE_AMOUNT = "15000";
process.env.CAMPAIGN_DURATION_DAYS = "30";
process.env.CAMPAIGN_INTERRUPTION_THRESHOLD = "10";
process.env.GAME_SUBMIT_GRACE_MS = "1000";
process.env.PROJECT_ID = "";
process.env.PRIVATE_KEY = "";
process.env.CLIENT_EMAIL = "";

// Models start building their indexes as soon as they are imported and buffer until
// the in-memory MongoDB is up. On a slow machine that can take longer than Mongoose's
// 10s default, which would poison every model for the rest of the file.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require("mongoose").set("bufferTimeoutMS", 170000);
