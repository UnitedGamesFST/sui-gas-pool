# AWS KMS Sui Signer 사이드카

본 사이드카는 AWS KMS 에 보관된 **Secp256k1** 키를 이용해 Sui 트랜잭션을 서명(Sign)하고, 공개키로부터 Sui 주소를 조회할 수 있는 간단한 HTTP 서비스입니다. 메인 애플리케이션과 같은 네트워크(예: 쿠버네티스 Pod, Docker Compose 네트워크 등)에서 함께 구동해 **키 비밀을 노출하지 않고** 안전하게 트랜잭션 서명을 위임할 수 있습니다.

## 1. 특징

* AWS KMS `Sign` / `Verify` API를 이용해 키를 절대 외부로 노출하지 않습니다.
* @mysten/sui SDK를 활용해 Sui 서명 직렬화(`flag || sig || pk`)까지 한 번에 처리합니다.
* Express 서버 기반이라 다른 언어·환경에서도 **HTTP 요청**만으로 쉽게 연동할 수 있습니다.

## 2. 설치 및 실행

```bash
# 1) 의존성 설치
cd aws_kms_sidecar
npm ci  # 또는 yarn

# 2) 환경 변수 설정 (로컬 개발용 예시)
cp env.example .env  # 필요한 값을 채워넣으세요
# .env 내용 예시
# AWS_REGION=ap-northeast-2
# AWS_ACCESS_KEY_ID=AKIA...
# AWS_SECRET_ACCESS_KEY=...
# AWS_KMS_KEY_ID=arn:aws:kms:ap-northeast-2:123456789012:key/abcd-efgh-...
# PORT=9001

# 3) 개발 모드 실행 (ts-node 기반 ‑ 코드 변경 시 실시간 반영)
npm run dev

# 4) 프로덕션 빌드 & 실행
npm run build
npm start
```

### Docker로 실행하기 (선택)
Dockerfile이 별도로 제공되지는 않지만 Node 런타임 이미지에서 다음 스크립트를 그대로 사용하면 됩니다.

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY aws_kms_sidecar/package*.json ./
RUN npm ci --omit=dev
COPY aws_kms_sidecar ./
RUN npm run build
EXPOSE 9001
CMD ["npm", "start"]
```

## 3. 환경 변수 정리

| 변수명 | 필수 | 설명 |
| ------ | ---- | ---- |
| `AWS_REGION` | ✔ | KMS 키가 위치한 리전. ex) `ap-northeast-2` |
| `AWS_ACCESS_KEY_ID` | ✔ | KMS API 호출용 IAM 액세스 키 |
| `AWS_SECRET_ACCESS_KEY` | ✔ | KMS API 호출용 IAM 시크릿 키 |
| `AWS_KMS_KEY_ID` | ✔ | 사용할 KMS 키의 **ARN** 또는 **KeyId** |
| `PORT` | ✖ | HTTP 서버 포트 (기본값 `9001`) |
| `LOG_LEVEL` | ✖ | pino 로거 레벨 (기본값 `info`) |

## 4. API 명세

> 모든 응답은 `application/json` 입니다.

### 4.1 `GET /`
서비스 기동 여부를 확인할 수 있는 간단한 문자열을 반환합니다.

```
200 OK
AWS KMS Sui Signer running
```

### 4.2 `GET /health`
로드밸런서 헬스체크 등에 사용할 수 있는 엔드포인트입니다.

```
200 OK
{ "ok": true }
```

### 4.3 `GET /aws-kms/get-pubkey-address`
설정된 `AWS_KMS_KEY_ID`의 공개키를 압축 Secp256k1 형태로 가져와 Sui 주소(`0x...`)를 반환합니다.

```
200 OK
{ "suiPubkeyAddress": "0x3f5a..." }
```

오류 발생 시 `500 Internal Server Error`.

### 4.4 `GET /aws-kms/get-pubkey`
설정된 `AWS_KMS_KEY_ID`의 공개키를 **압축 Secp256k1**(33바이트) 형식으로 조회해, `hex` 문자열(`0x...`)로 반환합니다.

```
200 OK
{ "publicKey": "0x04a1..." }
```

오류 발생 시 `500 Internal Server Error`.

### 4.5 `POST /aws-kms/sign-transaction`
Sui 트랜잭션 바이트를 **base64 문자열**로 전달하면, 직렬화된 Sui 서명을 반환합니다.

*요청*
```http
POST /aws-kms/sign-transaction HTTP/1.1
Content-Type: application/json

{
  "txBytes": "AAABAAFgcG5P..."  // base64-encoded BCS 트랜잭션
}
```

*성공 응답*
```http
200 OK
{
  "signature": "AQIGrH..."  // `flag||sig||pk` 직렬화 서명(base64)
}
```

*실패 응답*
```http
400 Bad Request
{ "error": "Signature error" }
```

### 4.6 `POST /aws-kms/sign-message`
32바이트 **해시(Digest)** 값을 `0x` 프리픽스가 붙은 Hex 문자열로 전달하면, 해당 해시에 대한 직렬화된 Sui 서명을 반환합니다.

*요청*
```http
POST /aws-kms/sign-message HTTP/1.1
Content-Type: application/json

{
  "hash": "0x3e5f..."  // 32-byte digest(hex)
}
```

*성공 응답*
```http
200 OK
{
  "signature": "AQIGrH..."  // `flag||sig||pk` 직렬화 서명(base64)
}
```

*실패 응답*
```http
400 Bad Request
{ "error": "Signature error" }
```

#### 서명 형식
* `signature` 필드는 Sui가 요구하는 직렬화 포맷(`flag || sig || pk`)을 그대로 base64 인코딩한 값입니다. Sui SDK 또는 RPC에 그대로 전달할 수 있습니다.

## 5. 내부 동작 흐름

1. 클라이언트가 `txBytes`(BCS bytes)를 전송합니다.
2. 사이드카는 **Intent 메타데이터**를 프리픽스로 붙인 후 `blake2b`(32 바이트) 해시를 계산합니다.
3. KMS `Sign` API(ECDSA_SHA_256)로 해시에 서명합니다.
4. DER 시그니처를 `(r, s)` 64바이트 컴팩트 형식으로 변환 후, Sui 직렬화를 수행합니다.
5. Sui SDK를 통해 트랜잭션 바이트 및 서명 검증 → 자체 검증 실패 시 오류 반환.
6. 최종적으로 클라이언트에게 직렬화 서명 값을 반환합니다.

> **참고:** 사이드카 자체에서도 KMS `Verify` API를 호출해 이중 검증을 수행합니다.

## 6. 로그 예시

pino 로거가 Pretty 프린터와 함께 설정되어 있어, 터미널에서 가독성 좋은 로그를 확인할 수 있습니다.

```
14:02:31  INFO Fetching Sui public key { address: '0x3f5a...' }
14:02:35  INFO TX Bytes and Digest { tx_bytes: 'AAABAA...', digest: 'c2M...', ... }
14:02:35 DEBUG Serialized signature { serializedSignature: 'AQIGrH...' }
```

`LOG_LEVEL=debug`로 설정하면 더 상세한 내부 단계 로그를 볼 수 있습니다.

## 7. 트러블슈팅

| 증상 | 원인/해결 |
| ---- | -------- |
| `Signature verification failed` | Sui에서 서명 검증 실패 → 트랜잭션 바이트와 Intent 구성 확인 |
| `KMS signature verification failed` | KMS Verify 실패 → 키 ID, 리전, 권한(IAM) 점검 |
| `Unable to fetch public key` | KMS GetPublicKey 권한 없음 또는 키가 비활성화됨 |

---

문의 사항이나 버그 제보는 [GitHub Issues](https://github.com/your-org/your-repo/issues)로 남겨주세요. 🎉 