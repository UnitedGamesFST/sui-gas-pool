import {
    DefaultAzureCredential,
    ClientSecretCredential
} from "@azure/identity";
import {
    KeyClient,
    CryptographyClient
} from "@azure/keyvault-keys";
import { 
    SIGNATURE_SCHEME_TO_FLAG,
    messageWithIntent,
} from "@mysten/sui/cryptography";
import { 
    Secp256k1PublicKey 
} from "@mysten/sui/keypairs/secp256k1";
import { toBase64 } from "@mysten/sui/utils";
import { blake2b } from "@noble/hashes/blake2";
import { Buffer } from "buffer";

// Azure 키 볼트 연결을 위한 기본 설정
function createAzureKeyVaultClient() {
    // 환경 변수에서 Azure 설정 가져오기
    const keyVaultName = process.env.AZURE_KEYVAULT_NAME || "";
    const keyVaultUrl = `https://${keyVaultName}.vault.azure.net`;
    
    let credential;
    // 서비스 프린시펄 인증 정보가 있는 경우
    if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID) {
        credential = new ClientSecretCredential(
            process.env.AZURE_TENANT_ID,
            process.env.AZURE_CLIENT_ID,
            process.env.AZURE_CLIENT_SECRET
        );
    } else {
        // 기본 인증 방식 사용 (관리 ID 등)
        credential = new DefaultAzureCredential();
    }
    
    return {
        keyClient: new KeyClient(keyVaultUrl, credential),
        keyVaultUrl,
        credential
    };
}

// Azure Key Vault에서 공개키 정보만 가져오기
export async function getPublicKey(keyName: string): Promise<Secp256k1PublicKey | undefined> {
    const { keyClient } = createAzureKeyVaultClient();
    
    try {
        // Azure Key Vault에서 키 정보 가져오기
        const keyBundle = await keyClient.getKey(keyName);
        
        if (!keyBundle.key || keyBundle.key.kty !== "EC" || keyBundle.key.crv !== "P-256K") {
            throw new Error("KeyVault key must be EC with secp256k1 curve (P-256K)");
        }
        
        if (!keyBundle.key.x || !keyBundle.key.y) {
            throw new Error("Public key components missing");
        }
        
        // EC 키의 x, y 좌표
        const xCoord = Buffer.from(keyBundle.key.x);
        const yCoord = Buffer.from(keyBundle.key.y);
        
        // 압축된 형식으로 공개키 생성: 0x02 또는 0x03 접두사 + x 좌표
        // 0x02: y가 짝수, 0x03: y가 홀수
        const lastByte = yCoord[yCoord.length - 1];
        const parityByte = lastByte % 2 === 0 ? 0x02 : 0x03;
        
        const compressedKey = Buffer.concat([
            Buffer.from([parityByte]),
            xCoord
        ]);
        
        // Sui에서 사용하는 Secp256k1PublicKey 형식으로 변환
        const suiPublicKey = new Secp256k1PublicKey(compressedKey);
        const suiAddress = suiPublicKey.toSuiAddress();
        
        console.log(`PubKey: ${suiAddress}`);
        
        return suiPublicKey;
    } catch (error) {
        console.error(`PubKey Error: ${error}`);
        return undefined;
    }
}

// HSM 내부에서 직접 서명하여 Sui 트랜잭션 서명 생성
export async function signAndVerify(txBytes: Uint8Array): Promise<string | undefined> {
    const keyName = process.env.AZURE_KEY_NAME || "";
    const { keyClient, credential } = createAzureKeyVaultClient();
    
    try {
        // 키 정보 가져오기 (HSM에서 서명하기 위해 키 ID 필요)
        const keyBundle = await keyClient.getKey(keyName);
        
        if (!keyBundle.key || keyBundle.key.kty !== "EC" || keyBundle.key.crv !== "P-256K") {
            throw new Error("KeyVault key must be EC with secp256k1 curve (P-256K)");
        }
        
        if (!keyBundle.id) {
            throw new Error("Key ID is missing");
        }
        
        // CryptographyClient 생성 (HSM에서 서명 처리)
        const cryptoClient = new CryptographyClient(keyBundle.id, credential);
        
        // 1. 의도를 포함한 메시지 생성 (Sui 표준)
        const intentMessage = messageWithIntent(
            "TransactionData",
            txBytes
        );
        
        // 2. blake2b 해시 생성 (Sui 표준)  
        const digest = blake2b(intentMessage, { dkLen: 32 });
        
        // 3. Azure HSM에서 직접 서명 (키는 HSM 내부에서만 사용됨)
        const signResult = await cryptoClient.sign("ES256K", digest);
        
        if (!signResult.result) {
            throw new Error("Failed to sign with Azure Key Vault HSM");
        }
        
        const rawSignature = Buffer.from(signResult.result);
        
        // 4. Azure HSM은 이미 raw r||s 형식(64바이트)으로 반환함
        if (rawSignature.length !== 64) {
            throw new Error(`Expected 64-byte signature, got ${rawSignature.length} bytes`);
        }
        
        // r과 s는 각각 32바이트
        const r = rawSignature.subarray(0, 32);
        const s = rawSignature.subarray(32, 64);
        const signatureBytes = Buffer.concat([r, s]); // 64 bytes
        
        // 5. 공개키 가져오기
        const pubKey = await getPublicKey(keyName);
        
        if (!pubKey) {
            throw new Error("Failed to get public key");
        }
        
        // 6. Sui signature format: [flag (1 byte)] + [sig (64)] + [pubKey (33)]
        const pubKeyBytes = pubKey.toRawBytes();
        const suiSignature = new Uint8Array([
            SIGNATURE_SCHEME_TO_FLAG["Secp256k1"],
            ...signatureBytes,
            ...pubKeyBytes,
        ]);
        
        const base64Signature = toBase64(suiSignature);
        
        // 검증
        const isValid = await pubKey.verifyTransaction(txBytes, base64Signature);
        console.log(`Signature: ${base64Signature.substring(0, 16)}... (verified: ${isValid})`);
        
        return base64Signature;
    } catch (error) {
        console.error(`Signature Error: ${error}`);
        return undefined;
    }
}

/*
// DER 인코딩 서명을 r, s로 파싱하는 함수 (현재 사용하지 않음)
function parseDERSignature(derSignature: Buffer): { r: Buffer; s: Buffer } {
    let offset = 0;
    
    // DER 시퀀스 확인 (0x30)
    if (derSignature[offset++] !== 0x30) {
        throw new Error("Invalid DER signature format");
    }
    
    // 전체 길이 건너뛰기
    offset++;
    
    // r 값 확인 (0x02)
    if (derSignature[offset++] !== 0x02) {
        throw new Error("Invalid r value marker");
    }
    
    // r 길이 읽기
    const rLen = derSignature[offset++];
    
    // r 값 읽기
    const rValue = derSignature.subarray(offset, offset + rLen);
    offset += rLen;
    
    // s 값 확인 (0x02)
    if (derSignature[offset++] !== 0x02) {
        throw new Error("Invalid s value marker");
    }
    
    // s 길이 읽기
    const sLen = derSignature[offset++];
    
    // s 값 읽기
    const sValue = derSignature.subarray(offset, offset + sLen);
    
    // r과 s를 32바이트로 패딩
    const rPadded = padTo32Bytes(rValue);
    const sPadded = padTo32Bytes(sValue);
    
    return { r: rPadded, s: sPadded };
}


// 필요한 경우 패딩 처리 (32바이트) - 현재 사용하지 않음
function padTo32Bytes(buffer: Buffer): Buffer {
    if (buffer.length === 32) {
        return buffer;
    }
    
    if (buffer.length > 32) {
        // 앞의 0 바이트 제거 (ASN.1 인코딩이 앞에 0을 추가할 수 있음)
        return Buffer.from(buffer.subarray(buffer.length - 32));
    }
    
    // 부족한 경우 앞에 0으로 패딩
    const padded = Buffer.alloc(32, 0);
    buffer.copy(padded, 32 - buffer.length);
    return padded;
}
*/