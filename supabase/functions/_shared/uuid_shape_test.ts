import { isUuidShape } from "./uuid_shape.ts"

const demoT04 = "94776352-e7ea-37de-5385-79778a8368f4"
if (!isUuidShape(demoT04)) {
  throw new Error(`expected demo ticket t04 uuid to pass shape check: ${demoT04}`)
}

const strictOnly = "00000000-0000-0000-0000-000000000000"
if (!isUuidShape(strictOnly)) {
  throw new Error("expected all-zero uuid to pass shape check")
}

if (isUuidShape("not-a-uuid")) {
  throw new Error("expected garbage to fail shape check")
}

console.log("uuid_shape_test ok")
