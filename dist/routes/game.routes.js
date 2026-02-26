"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const game_controller_1 = require("../controllers/game.controller");
const router = (0, express_1.Router)();
router.post('/slots/spin', game_controller_1.slotsSpin);
// Add more games as needed
exports.default = router;
