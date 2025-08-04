"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scaffold = scaffold;
const path_1 = __importDefault(require("path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
async function scaffold(options) {
    const { appName } = options;
    const templateDir = path_1.default.resolve(__dirname, "../templates/ts-template");
    const targetDir = path_1.default.resolve(process.cwd(), appName);
    if (await fs_extra_1.default.pathExists(targetDir)) {
        throw new Error(`Directory "${appName}" already exists.`);
    }
    await fs_extra_1.default.copy(templateDir, targetDir, {
        filter: (src) => {
            const basename = path_1.default.basename(src);
            return basename !== ".git" && basename !== "node_modules";
        },
        preserveTimestamps: true,
    });
    console.log(`✔️  Scaffolded "${appName}" from template.`);
}
