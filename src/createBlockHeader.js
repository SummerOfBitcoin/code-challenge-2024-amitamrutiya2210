import crypto from "crypto";
import { createMerkleRoot, toLittleEndian } from "./utils.js";

function targetToBits(target) {
  let targetBigInt = BigInt("0x" + target);
  let exponent = 0;
  while (targetBigInt > 0n) {
    targetBigInt >>= 8n;
    exponent++;
  }
  let coefficientBigInt =
    BigInt("0x" + target) >> (8n * (BigInt(exponent) - 3n));
  if ((coefficientBigInt & 0x00800000n) !== 0n) {
    coefficientBigInt >>= 8n;
    exponent++;
  }
  let bitsBigInt =
    (BigInt(exponent) << 24n) | (coefficientBigInt & 0x007fffffn);
  return bitsBigInt.toString(16).padStart(8, "0");
}

function hash256(data) {
  const binary = Buffer.from(data, "hex");
  const hash1 = crypto.createHash("sha256").update(binary).digest();
  const hash2 = crypto.createHash("sha256").update(hash1).digest("hex");
  return hash2;
}

function dateStringToUnixTime() {
  var date = new Date();
  return Math.floor(date.getTime() / 1000);
}

// Convert a number to fit inside a field that is a specific number of bytes e.g. field(1, 4) = 00000001
function field(data, size) {
  return BigInt(data)
    .toString(16)
    .padStart(size * 2, "0");
}

export function createBlockHeader(transactions) {
  const target =
    "0000ffff00000000000000000000000000000000000000000000000000000000";
  const version = "4";
  const prevblock =
    "0000000000000000000000000000000000000000000000000000000000000000";
  const time = dateStringToUnixTime();
  const bits = targetToBits(target);
  let nonce = 0;
  const allTxids = transactions.map((tx) => tx.TxId);
  const merkleroot = createMerkleRoot(allTxids);

  // Block Header (Serialized)
  let header =
    toLittleEndian(field(version, 4)) +
    toLittleEndian(prevblock) +
    merkleroot +
    toLittleEndian(field(time, 4)) +
    toLittleEndian(bits);

  while (true) {
    // hash the block header
    const attempt = header + toLittleEndian(field(nonce, 4));
    const result = toLittleEndian(hash256(attempt));

    // end if we get a block hash below the target
    if (BigInt("0x" + result) < BigInt("0x" + target)) {
      break;
    }

    // increment the nonce and try again...
    nonce++;
  }
  header = header + toLittleEndian(field(nonce, 4));
  return header;
}