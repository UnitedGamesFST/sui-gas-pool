import {
    DefaultAzureCredential,
    ClientSecretCredential
} from "@azure/identity";
import {
    KeyClient,
    CryptographyClient
} from "@azure/keyvault-keys";
import { Secp256k1PublicKey } from "@mysten/sui.js/keypairs/secp256k1";
import { toB64 } from "@mysten/sui.js/utils";
import {
    toSerializedSignature,
    SerializedSignature,
    messageWithIntent,
    IntentScope,
} from "@mysten/sui.js/cryptography";
import { blake2b } from "@noble/hashes/blake2b";

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

// Azure Key Vault에서 공개키 가져오기
export async function getPublicKey(keyName: string): Promise<Secp256k1PublicKey | undefined> {
    const { keyClient } = createAzureKeyVaultClient();
    
    try {
        // Azure Key Vault에서 키 가져오기
        const key = await keyClient.getKey(keyName);
        
        if (!key.key || !key.key.x || !key.key.y) {
            throw new Error("Public key components missing");
        }
        
        // EC 키의 x, y 좌표
        const xCoord = Buffer.from(key.key.x);
        const yCoord = Buffer.from(key.key.y);
        
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
        console.log("Sui Public Key:", suiPublicKey.toSuiAddress());
        
        return suiPublicKey;
    } catch (error) {
        console.error("Error fetching public key from Azure Key Vault:", error);
        return undefined;
    }
}

// 트랜잭션 서명 및 검증
export async function signAndVerify(txBytes: Uint8Array): Promise<SerializedSignature | undefined> {
    const keyName = process.env.AZURE_KEY_NAME || "";
    const { keyClient, keyVaultUrl, credential } = createAzureKeyVaultClient();
    
    try {
        // 키 가져오기
        const key = await keyClient.getKey(keyName);
        
        if (!key || !key.id) {
            throw new Error("Failed to get key or key.id is undefined");
        }
        
        // CryptographyClient 생성
        const cryptoClient = new CryptographyClient(key.id, credential);
        
        // 의도를 포함한 메시지 생성
        const intentMessage = messageWithIntent(
            IntentScope.TransactionData,
            txBytes
        );
        
        // 다이제스트 계산 (hash)
        const digest = blake2b(intentMessage, { dkLen: 32 });
        console.log("TX Bytes:", toB64(txBytes));
        console.log("Digest:", toB64(digest));
        
        // Azure HSM을 사용하여 서명
        const signResult = await cryptoClient.sign("ES256K", digest);
        
        if (!signResult.result) {
            throw new Error("Failed to sign with Azure Key Vault");
        }
        
        // DER 형식의 서명을 [r,s] 형식으로 변환
        const concatenatedSignature = convertDERtoRS(Buffer.from(signResult.result));
        
        // 공개키 가져오기
        const suiPublicKey = await getPublicKey(keyName);
        
        if (!suiPublicKey) {
            throw new Error("Failed to get public key");
        }
        
        // Sui 형식의 직렬화된 서명 생성
        const serializedSignature = toSerializedSignature({
            signatureScheme: "Secp256k1",
            signature: concatenatedSignature,
            publicKey: suiPublicKey,
        });
        
        console.log("Serialized Signature:", serializedSignature);
        
        // Sui 서명 검증
        const isValid = await suiPublicKey.verifyTransactionBlock(
            txBytes,
            serializedSignature
        );
        console.log("Sui Signature valid:", isValid);
        
        return serializedSignature;
    } catch (error) {
        console.error("Error during sign/verify:", error);
        return undefined;
    }
}

// DER 인코딩 서명을 [r,s] 형식으로 변환
function convertDERtoRS(derSignature: Buffer): Uint8Array {
    // DER 형식: 30 + len + 02 + r_len + r + 02 + s_len + s
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
    const rValue = derSignature.slice(offset, offset + rLen);
    offset += rLen;
    
    // s 값 확인 (0x02)
    if (derSignature[offset++] !== 0x02) {
        throw new Error("Invalid s value marker");
    }
    
    // s 길이 읽기
    const sLen = derSignature[offset++];
    
    // s 값 읽기
    const sValue = derSignature.slice(offset, offset + sLen);
    
    // r과 s를 32바이트로 패딩
    const rPadded = padTo32Bytes(rValue);
    const sPadded = padTo32Bytes(sValue);
    
    // r과 s 결합
    return Buffer.concat([rPadded, sPadded]);
}

// 필요한 경우 패딩 처리 (32바이트)
function padTo32Bytes(buffer: Buffer): Buffer {
    if (buffer.length === 32) {
        return buffer;
    }
    
    if (buffer.length > 32) {
        // 앞의 0 바이트 제거 (ASN.1 인코딩이 앞에 0을 추가할 수 있음)
        return buffer.slice(buffer.length - 32);
    }
    
    // 부족한 경우 앞에 0으로 패딩
    const padded = Buffer.alloc(32, 0);
    buffer.copy(padded, 32 - buffer.length);
    return padded;
} 