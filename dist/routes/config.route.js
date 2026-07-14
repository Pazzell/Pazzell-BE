"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const config_controller_1 = require("../controllers/config.controller");
const auth_1 = require("../utils/auth");
const router = express_1.default.Router();
router.get("/admin/config", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("admin"), config_controller_1.listConfig);
router.put("/admin/config/:key", auth_1.isAuthenticated, (0, auth_1.authorizeRoles)("admin"), config_controller_1.updateConfig);
exports.default = router;
