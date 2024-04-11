import { isValidSignature } from "./verifySignature.js";
import { hash160, sha256 } from "./utils.js";

export function executeScript(transaction) {
  let allValid = true;
  for (let input of transaction.vin) {
    // console.log("Input: ", input)
    let stack = [];
    let script = "";
    let scriptTokens = [];

    if (input.prevout.scriptpubkey_type === "p2pkh") {
      script = input.scriptsig_asm + " " + input.prevout.scriptpubkey_asm;
      scriptTokens = script.split(" ");
    } else if (
      input.prevout.scriptpubkey_type === "p2sh" &&
      input.witness === undefined &&
      !input.inner_redeemscript_asm.split(" ").includes("OP_CSV")
    ) {
      const scriptsig_asm = input.scriptsig_asm.split(" ");
      const inner_redeemscript = [
        scriptsig_asm[scriptsig_asm.length - 2],
        scriptsig_asm[scriptsig_asm.length - 1],
      ];
      const scriptSig = input.scriptsig_asm.split(" ");
      scriptSig.splice(-2, 2);

      script = [
        ...scriptSig,
        ...input.inner_redeemscript_asm.split(" "),
        ...inner_redeemscript,
        ...input.prevout.scriptpubkey_asm.split(" "),
      ];
      scriptTokens = script;
      // console.log(scriptTokens);
    } else if (
      input.prevout.scriptpubkey_type === "p2sh" &&
      input.witness !== undefined &&
      input.witness.length === 2
    ) {
      script =
        "OP_CHECKSIG" +
        " " +
        input.scriptsig_asm +
        " " +
        input.prevout.scriptpubkey_asm;
      scriptTokens = script.split(" ");
      if (input.witness.length === 2) {
        stack.push(input.witness[0]);
        stack.push(input.witness[1]);
      }
    } else if (
      input.prevout.scriptpubkey_type === "p2sh" &&
      input.witness !== undefined &&
      input.witness.length > 2 &&
      !input.inner_witnessscript_asm.split(" ").includes("OP_CSV") &&
      !input.inner_witnessscript_asm.split(" ").includes("OP_DROP")
    ) {
      const signatures = input.witness.slice(1, -1);
      const scriptsig = input.scriptsig_asm.split(" ")[1];
      stack.push(...signatures);
      script =
        input.inner_witnessscript_asm +
        " " +
        scriptsig +
        " " +
        input.prevout.scriptpubkey_asm;
      // console.log(script);
      scriptTokens = script.split(" ");
    } else if (
      input.prevout.scriptpubkey_type === "v0_p2wsh" &&
      input.witness !== undefined &&
      input.witness[0] === ""
    ) {
      const signatures = input.witness.slice(1, -1);
      const scriptsig = input.witness[input.witness.length - 1];
      stack.push(...signatures);
      script =
        input.inner_witnessscript_asm +
        " " +
        scriptsig +
        " OP_SHA256 " +
        input.prevout.scriptpubkey_asm +
        " OP_EQUAL";
      scriptTokens = script.split(" ");
    } else if (input.prevout.scriptpubkey_type === "v0_p2wpkh") {
      const pkh = input.prevout.scriptpubkey_asm.split(" ")[2];
      stack.push(input.witness[0]);
      stack.push(input.witness[1]);

      script = "OP_DUP OP_HASH160 " + pkh + " OP_EQUALVERIFY OP_CHECKSIG";

      scriptTokens = script.split(" ");
    } else if (input.prevout.scriptpubkey_type === "v1_p2tr") {
      return true;
    } else {
      console.log("Unsupported script type in " + input.txid);
      return false;
    }
    while (scriptTokens.length > 0) {
      const token = scriptTokens.shift();
      if (token === "OP_CHECKSIG") {
        // Check signature
        const publicKey = stack.pop();
        const signature = stack.pop();
        const isValid = isValidSignature(
          transaction,
          input,
          [signature],
          [publicKey]
        );
        stack.push(isValid);
      } else if (token === "OP_EQUALVERIFY") {
        // Check equality and verify
        const value1 = stack.pop();
        const value2 = stack.pop();
        if (value1 !== value2) {
          console.log("Values not equal in" + input.txid);
          return false; // Values not equal
        }
      } else if (token === "OP_EQUAL") {
        const value1 = stack.pop();
        const value2 = stack.pop();
        if (value1 === value2) {
          stack.push(true);
        } else {
          stack.push(false);
        }
      } else if (token === "OP_DUP") {
        // Duplicate the top item on the stack
        const topItem = stack[stack.length - 1];
        stack.push(topItem);
      } else if (token === "OP_HASH160") {
        // Apply the SHA-256 hash followed by the RIPEMD-160 hash to the top item on the stack
        const data = stack.pop();
        const hashedData = hash160(data);
        stack.push(hashedData);
      } else if (token === "OP_PUSHDATA1") {
        const bytes = scriptTokens.shift();
        stack.push(bytes);
      } else if (token.startsWith("OP_PUSHBYTES_")) {
        // Push data onto the stack
        const bytesLength = parseInt(token.substring("OP_PUSHBYTES_".length));
        const bytes = scriptTokens.shift();

        // Check that the length of bytes matches bytesLength
        if (bytes.length / 2 !== bytesLength) {
          console.log("Invalid number of bytes");
          return false;
        }
        stack.push(bytes);
      } else if (token === "OP_0") {
      } else if (token === "OP_CHECKMULTISIG") {
        const n = parseInt(stack.pop().substring("OP_PUSHNUM_".length));
        const publicKeys = [];
        for (let i = 0; i < n; i++) {
          publicKeys.push(stack.pop());
        }
        const m = parseInt(stack.pop().substring("OP_PUSHNUM_".length));

        const signatures = [];
        for (let i = 0; i < m; i++) {
          signatures.push(stack.pop());
        }
        // console.log("Public keys: ", publicKeys);
        // console.log("Signatures: ", signatures);
        const isValid = isValidSignature(
          transaction,
          input,
          signatures,
          publicKeys
        );
        stack.push(isValid);
      } else if (token === "OP_SHA256") {
        const data = stack.pop();
        const hashedData = sha256(data);
        stack.push(hashedData);
      } else {
        stack.push(token);
      }
      // Log the state of the stack
      // console.log(`After executing ${token}, stack is: `, stack);
    }

    // Check if the stack is empty and contains only true values
    for (let i = 0; i < stack.length; i++) {
      if (stack[i] !== true) {
        allValid = false;
      }
    }
    if (stack.length === 0) allValid = false;
  }
  return allValid;
}
