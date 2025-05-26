import express, { Request, Response } from "express";
import { fromB64 } from "@mysten/sui.js/utils";
import { getPublicKey, signAndVerify } from "./azureUtils";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
    const app = express();
    app.use(express.json());
    const port = parseInt(process.env.PORT || "3000");
    app.get("/", (req: Request, res: Response) => {
        res.send("Azure HSM Signer Demo!");
    });

    app.get("/azure-hsm/get-pubkey-address", async (req: Request, res: Response) => {
        try {
            const keyName = process.env.AZURE_KEY_NAME || "";
            const publicKey = await getPublicKey(keyName);
            
            if (!publicKey) {
                return res.status(500).send("Failed to fetch public key");
            }
            
            const suiPubkeyAddress = publicKey.toSuiAddress();
            res.json({ suiPubkeyAddress });
        } catch (error) {
            console.error(error);
            res.status(500).send("Internal server error");
        }
    });

    app.post("/azure-hsm/sign-transaction", async (req: Request, res: Response) => {
        try {
            const { txBytes } = req.body;

            if (!txBytes) {
                return res
                    .status(400)
                    .send("Missing transaction bytes");
            }

            const txBytesArray = fromB64(txBytes);
            const signature = await signAndVerify(txBytesArray);

            if (!signature) {
                return res.status(500).send("Failed to sign transaction");
            }

            res.json({ signature });
        } catch (error) {
            console.error(error);
            res.status(500).send("Internal server error");
        }
    });

    app.listen(port, () => {
        console.log(`Azure HSM Sidecar running at http://localhost:${port}`);
    });
}

main(); 