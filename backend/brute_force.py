import base64
from cryptography.hazmat.primitives.serialization import load_pem_public_key
import os

# The known corrupted body string (391 chars)
body = (
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqAEKbUCJKC2PK/hTV9L/"
    "xDKh4rZ9ibj6f6pNUhd3phMnYd+7/t23iTgrH0qD196iA7LGqq7AER1LtOCKUVB8"
    "y5RfxMimYFeoLV4BJHzcDoOFUzu+sdXQuyNrqGuk2zii6LYnTzVVUpwV8OLJS8xr"
    "pazaxHqsuf2u3RRTl+7Q4PcigNjx5Lt62OHjV+q3ghMoxh0o07UQoJpWEpOLd5Ay"
    "nSf+JW5gBYxYGmJRLO9l61JSaOSldDZjVO0K7z2UWtq7TMlADb50c9tdYc2Ju8H"
    "wFHkp43kHnqSacm/Ab8HZFKidYpjx/SA8G205gZwsZ3LX868Jwrda08coSv7cCMT"
    "6QIDAQAB"
)

charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

print(f"Original length: {len(body)}")
success = False

# Try inserting each of the 64 characters at index 256 (where \v replaced the space)
for i in range(256, 320):
    for char in charset:
        test_body = body[:i] + char + body[i:]
        pem = f"-----BEGIN PUBLIC KEY-----\n{test_body[:64]}\n{test_body[64:128]}\n{test_body[128:192]}\n{test_body[192:256]}\n{test_body[256:320]}\n{test_body[320:384]}\n{test_body[384:]}\n-----END PUBLIC KEY-----"
        try:
            load_pem_public_key(pem.encode())
            print(f"SUCCESS! Found missing character '{char}' at index {i}!")
            with open("/app/valid_pem.txt", "w") as f:
                f.write(pem.replace('\n', '\\n'))
            success = True
            break
        except Exception:
            continue
    if success: break

if not success:
    print("Not found in line 5. Trying other places just in case...")
    for i in range(0, len(body)+1):
        for char in charset:
            test_body = body[:i] + char + body[i:]
            pem = f"-----BEGIN PUBLIC KEY-----\n{test_body[:64]}\n{test_body[64:128]}\n{test_body[128:192]}\n{test_body[192:256]}\n{test_body[256:320]}\n{test_body[320:384]}\n{test_body[384:]}\n-----END PUBLIC KEY-----"
            try:
                load_pem_public_key(pem.encode())
                print(f"SUCCESS! Found missing character '{char}' at index {i}!")
                with open("/app/valid_pem.txt", "w") as f:
                    f.write(pem.replace('\n', '\\n'))
                success = True
                break
            except Exception:
                continue
        if success: break
