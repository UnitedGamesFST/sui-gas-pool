import "dotenv/config";
import express from "express";
import { fromBase64 } from "@mysten/sui/utils";
import { Secp256k1PublicKey } from "@mysten/sui/keypairs/secp256k1";
import { getPublicKey, signAndVerify } from "./awsUtils.js";
import logger from "./logger.js";
import { z } from "zod";

async function main() {
    const app = express();
    app.use(express.json());
    const port = process.env.PORT ? Number(process.env.PORT) : 9001;
    
    app.get("/", (_req, res) => {
        res.send("AWS KMS Sui Signer running");
    });

    app.get("/health", (_req, res) => {
        res.json({ ok: true });
    });

    app.get("/aws-kms/get-pubkey-address", async (req, res) => {
        try {
            const keyId = process.env.AWS_KMS_KEY_ID || "";
            const publicKey = await getPublicKey(keyId);
            const publicKeyToUse = publicKey instanceof Secp256k1PublicKey
                ? publicKey
                : undefined;
            const suiPubkeyAddress = publicKeyToUse!.toSuiAddress();
            res.json({ suiPubkeyAddress });
        } catch (error) {
            console.error(error);
            res.status(500).send("Internal server error");
        }
    });

    app.post("/aws-kms/sign-transaction", async (req, res) => {
        try {
            const schema = z.object({ txBytes: z.string().max(10000) });
            const parseResult = schema.safeParse(req.body);
            if (!parseResult.success) {
                return res.status(400).json({ error: "Invalid request body" });
            }

            const txBytesArray = fromBase64(parseResult.data.txBytes);

            const signature = await signAndVerify(txBytesArray);
            res.json({ signature });
        } catch (err: any) {
            logger.error({ err }, "Signature generation failed");
            res.status(400).json({ error: err.message ?? "Signature error" });
        }
    });

    app.listen(port, () => {
        logger.info(`AWS KMS Signer listening at http://localhost:${port}`);
    });
}

main();
