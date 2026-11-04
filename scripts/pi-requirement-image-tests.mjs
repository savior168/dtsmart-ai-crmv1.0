import assert from "node:assert/strict";
import { isPiRequirementImage, PI_REQUIREMENT_IMAGE_LIMIT } from "../lib/pi-requirement-image.ts";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const webp = Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
assert.equal(isPiRequirementImage(jpeg, "image/jpeg"), true);
assert.equal(isPiRequirementImage(png, "image/png"), true);
assert.equal(isPiRequirementImage(webp, "image/webp"), true);
assert.equal(isPiRequirementImage(png, "image/jpeg"), false);
assert.equal(isPiRequirementImage(Buffer.from("<script>alert(1)</script>"), "image/png"), false);
assert.equal(isPiRequirementImage(new Uint8Array(PI_REQUIREMENT_IMAGE_LIMIT + 1), "image/png"), false);
console.log("PI requirement image validation tests passed");
