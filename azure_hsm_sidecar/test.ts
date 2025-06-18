import dotenv from "dotenv";
import { getPublicKey, signAndVerify } from "./azureUtils";

// .env 파일 로드
dotenv.config();

async function testGetPublicKey() {
    console.log("=== Azure Key Vault Public Key Test ===");
    
    // 환경변수 확인
    console.log("Environment variables:");
    console.log("AZURE_KEYVAULT_NAME:", process.env.AZURE_KEYVAULT_NAME);
    console.log("AZURE_KEY_NAME:", process.env.AZURE_KEY_NAME);
    console.log("AZURE_CLIENT_ID:", process.env.AZURE_CLIENT_ID ? "✓ Set" : "✗ Not set");
    console.log("AZURE_CLIENT_SECRET:", process.env.AZURE_CLIENT_SECRET ? "✓ Set" : "✗ Not set");
    console.log("AZURE_TENANT_ID:", process.env.AZURE_TENANT_ID ? "✓ Set" : "✗ Not set");
    console.log("");

    try {
        const keyName = process.env.AZURE_KEY_NAME || "";
        
        if (!keyName) {
            throw new Error("AZURE_KEY_NAME environment variable is not set");
        }

        console.log(`Fetching public key for: ${keyName}`);
        console.log("Connecting to Azure Key Vault...");
        
        const publicKey = await getPublicKey(keyName);
        
        if (publicKey) {
            console.log("✅ Successfully retrieved public key!");
            console.log("Sui Address:", publicKey.toSuiAddress());
            console.log("Public Key (base64):", publicKey.toSuiPublicKey());
            return publicKey;
        } else {
            console.log("❌ Failed to retrieve public key");
            return null;
        }
        
    } catch (error) {
        console.error("❌ Error:", error);
        return null;
    }
}

async function testSignText() {
    console.log("\n=== Azure HSM Signature Test ===");
    
    try {
        // 테스트할 간단한 텍스트
        const testText = "Hello, Azure HSM! This is a test message for signing.";
        console.log("Test message:", testText);
        
        // 텍스트를 Uint8Array로 변환
        const textEncoder = new TextEncoder();
        const textBytes = textEncoder.encode(testText);
        
        console.log("Message bytes length:", textBytes.length);
        console.log("Signing with Azure HSM...");
        
        // HSM에서 서명
        const signature = await signAndVerify(textBytes);
        
        if (signature) {
            console.log("✅ Successfully signed message!");
            console.log("Signature (base64):", signature);
            console.log("Signature length:", signature.length);
        } else {
            console.log("❌ Failed to sign message");
        }
        
        return signature;
        
    } catch (error) {
        console.error("❌ Signing error:", error);
        return null;
    }
}

async function runAllTests() {
    console.log("🚀 Starting Azure HSM Tests...\n");
    
    // 1. 공개키 테스트
    const publicKey = await testGetPublicKey();
    
    if (publicKey) {
        // 2. 서명 테스트
        const signature = await testSignText();
        
        if (signature) {
            console.log("\n🎉 All tests completed successfully!");
        } else {
            console.log("\n❌ Signature test failed");
        }
    } else {
        console.log("\n❌ Public key test failed, skipping signature test");
    }
}

// 모든 테스트 실행
runAllTests(); 