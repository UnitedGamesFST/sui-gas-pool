# Azure HSM Sidecar

Azure Key Vault HSM을 사용하여 Sui 트랜잭션에 서명하는 사이드카 서버입니다.

## ✨ 기능

- 🔐 Azure Key Vault HSM에서 안전한 서명 (개인키가 HSM 외부로 노출되지 않음)
- 🌐 REST API를 통한 Sui 트랜잭션 서명
- 🔑 Sui 공개키 주소 조회
- 📝 간결한 로깅 시스템
- ⚡ TypeScript로 구현

## 🚀 설치

```bash
npm install
```

## ⚙️ 환경 설정

`.env` 파일을 생성하고 다음 환경 변수를 설정하세요:

```env
AZURE_KEYVAULT_NAME=your-keyvault-name
AZURE_KEY_NAME=your-key-name
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_TENANT_ID=your-tenant-id
PORT=9001
```

## 📖 사용법

### 서버 실행
```bash
npm start
# 또는
npx ts-node index.ts
```

### 테스트
```bash
npx ts-node test.ts
```

## 🌐 API 엔드포인트

### Health Check
```http
GET /
```

### 공개키 주소 조회
```http
GET /azure-hsm/get-pubkey-address
```

**응답:**
```json
{
  "suiPubkeyAddress": "0x9dfd92812dc9591424eaa88cb154345656b9c3fcfee19b490c67bb1393dbcf7e"
}
```

### 트랜잭션 서명
```http
POST /azure-hsm/sign-transaction
Content-Type: application/json

{
  "txBytes": "base64-encoded-transaction-bytes"
}
```

**응답:**
```json
{
  "signature": "base64-encoded-sui-signature"
}
```

## 🔧 트러블슈팅

### 인증 오류
```
AADSTS7000215: Invalid client secret provided
```
**해결방법:** Service Principal의 client secret을 재생성하세요.
```bash
az ad sp credential reset --id "your-client-id"
```

### Key Vault 접근 오류
```
Access denied
```
**해결방법:** Key Vault 권한을 확인하세요.
```bash
az keyvault set-policy --name "your-keyvault" --spn "your-client-id" --key-permissions get sign verify
```

### 키 형식 오류
```
KeyVault key must be EC with secp256k1 curve (P-256K)
```
**해결방법:** Key Vault에서 secp256k1 (P-256K) 커브를 사용하는 EC 키를 생성하세요.

## 📁 프로젝트 구조

```
azure_hsm_sidecar/
├── azureUtils.ts      # Azure Key Vault HSM 유틸리티
├── index.ts           # Express 서버 및 API 엔드포인트
├── test.ts            # 테스트 스크립트
├── package.json       # 의존성 및 스크립트
├── tsconfig.json      # TypeScript 설정
└── README.md          # 이 파일
```

## 🔒 보안

- 개인키는 절대 HSM 외부로 노출되지 않음
- 모든 서명 작업이 Azure HSM 내부에서 수행됨
- Service Principal을 통한 안전한 인증
- 환경 변수로 민감한 정보 관리

## 📝 라이선스

이 프로젝트는 Sui Gas Pool 프로젝트의 일부입니다. 