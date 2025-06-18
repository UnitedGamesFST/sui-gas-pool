import express, { Request, Response, NextFunction } from "express";
import { getPublicKey, signAndVerify } from "./azureUtils";
import { fromBase64 } from "@mysten/sui/utils";
import dotenv from "dotenv";

// .env 파일 로드
dotenv.config();

// 간결한 로깅 미들웨어
function logger(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const method = req.method;
    const url = req.url;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    
    // 응답 완료 시 로깅
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const status = res.statusCode;
        const statusIcon = status >= 400 ? '❌' : '✅';
        
        console.log(`${statusIcon} ${method} ${url} - ${status} - ${duration}ms - ${ip}`);
    });
    
    next();
}

async function main() {
    const app = express();
    app.use(express.json());
    app.set('trust proxy', true);
    app.use(logger);
    
    const port = parseInt(process.env.PORT || "9001");
    
    console.log(`🚀 Azure HSM Sidecar - Port: ${port} - KeyVault: ${process.env.AZURE_KEYVAULT_NAME} - Key: ${process.env.AZURE_KEY_NAME}`);
    
    app.get("/", (_req: Request, res: Response) => {
        res.send("Azure HSM Signer!");
    });

    app.get("/azure-hsm/get-pubkey-address", async (_req: Request, res: Response): Promise<void> => {
        try {
            const keyName = process.env.AZURE_KEY_NAME || "";
            if (!keyName) {
                res.status(500).send("Azure key name not configured");
                return;
            }
            
            const publicKey = await getPublicKey(keyName);
            if (!publicKey) {
                res.status(500).send("Failed to fetch public key");
                return;
            }
            
            const suiPubkeyAddress = publicKey.toSuiAddress();
            res.json({ suiPubkeyAddress });
        } catch (error) {
            console.error("GET-PUBKEY Error:", error);
            res.status(500).send("Internal server error");
        }
    });

    app.post("/azure-hsm/sign-transaction", async (req: Request, res: Response): Promise<void> => {
        try {
            const { txBytes } = req.body;
            if (!txBytes) {
                res.status(400).send("Missing transaction bytes");
                return;
            }

            const txBytesArray = fromBase64(txBytes);
            const signature = await signAndVerify(txBytesArray);

            if (!signature) {
                res.status(500).send("Failed to sign transaction");
                return;
            }

            res.json({ signature });
        } catch (error) {
            console.error("SIGN-TX Error:", error);
            res.status(500).send("Internal server error");
        }
    });

    app.listen(port, () => {
        console.log(`🎯 Server running at http://localhost:${port}`);
    });
}

main(); 