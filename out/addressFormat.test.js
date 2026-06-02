"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const addressFormat_1 = require("./addressFormat");
function assertInvalid(token) {
    const result = (0, addressFormat_1.validateHaproxyAddress)(token, { portPolicy: "optional" });
    if (result.valid) {
        throw new Error(`expected invalid: ${token}`);
    }
}
function assertValid(token, portPolicy = "optional") {
    const result = (0, addressFormat_1.validateHaproxyAddress)(token, { portPolicy });
    if (!result.valid) {
        throw new Error(`expected valid: ${token} -> ${result.message}`);
    }
}
assertInvalid("blah");
assertInvalid("127.0.0.1.2.8.7:22");
assertValid("127.0.0.1:22");
assertValid("localhost");
assertValid("/var/run/haproxy.sock", "optional");
assertValid(":443", "required");
if (!(0, addressFormat_1.looksLikeAddressToken)("127.0.0.1:22")) {
    throw new Error("looksLikeAddressToken failed");
}
console.log("addressFormat.test.ts ok");
//# sourceMappingURL=addressFormat.test.js.map