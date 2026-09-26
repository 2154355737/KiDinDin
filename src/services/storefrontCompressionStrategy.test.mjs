import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeStorefrontPhoto,
  STOREFRONT_TARGET_BYTES,
} from "./storefrontCompressionStrategy.ts";

const jpeg = (size) => new Blob([new Uint8Array(size)], { type: "image/jpeg" });

test("accepts the size boundary and preserves exact portrait dimensions", async () => {
  const calls = [];
  const blob = await encodeStorefrontPhoto(3000, 4000, async (...args) => {
    calls.push(args);
    return jpeg(STOREFRONT_TARGET_BYTES);
  });
  assert.equal(blob.size, STOREFRONT_TARGET_BYTES);
  assert.deepEqual(calls, [[3000, 4000, 0.82]]);
});

test("adapts quality to measured size while preserving exact landscape dimensions", async () => {
  const calls = [];
  const blob = await encodeStorefrontPhoto(4000, 3000, async (width, height, quality) => {
    calls.push({ width, height, quality });
    return jpeg(Math.ceil(quality * 900000));
  });
  assert.ok(blob.size <= STOREFRONT_TARGET_BYTES);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].quality < calls[0].quality);
  assert.ok(calls.every(({ width, height }) => width === 4000 && height === 3000));
});

test("does not upscale small images", async () => {
  await encodeStorefrontPhoto(320, 240, async (width, height) => {
    assert.equal(width, 320);
    assert.equal(height, 240);
    return jpeg(1000);
  });
});

test("bounds encoding attempts and accepts oversized results without resizing", async () => {
  let count = 0;
  const result = await encodeStorefrontPhoto(4000, 3000, async (width, height, quality) => {
    count += 1;
    assert.equal(width, 4000);
    assert.equal(height, 3000);
    assert.ok(quality >= 0.5);
    return jpeg(STOREFRONT_TARGET_BYTES + 1);
  });
  assert.equal(result.size, STOREFRONT_TARGET_BYTES + 1);
  assert.ok(count <= 4);
});

test("keeps the smallest valid result if encoder sizes are not monotonic", async () => {
  const sizes = [800000, 900000];
  const result = await encodeStorefrontPhoto(4000, 3000, async () => jpeg(sizes.shift() ?? 950000));
  assert.equal(result.size, 800000);
});

test("rejects invalid dimensions before encoding", async () => {
  for (const width of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(encodeStorefrontPhoto(width, 3000, async () => {
      assert.fail("must not encode invalid dimensions");
    }), /尺寸无效/);
  }
});

test("rejects empty or non-JPEG encodings and propagates encoder failure", async () => {
  for (const blob of [jpeg(0), new Blob(["png"], { type: "image/png" })]) {
    await assert.rejects(encodeStorefrontPhoto(100, 100, async () => blob), /JPEG/);
  }
  await assert.rejects(encodeStorefrontPhoto(100, 100, async () => {
    throw new Error("encoder failed");
  }), /encoder failed/);
});
