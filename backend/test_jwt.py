import jwt
from jwt import get_unverified_header

token = "eyJhbGciOiJSUzI1NiIsImtpZCI6Imluc2VydF9raWQwIn0.eyJzdWIiOiJ1c2VyMTIzIiwiaWF0IjoxNTE2MjM5MDIyfQ.signature"

try:
    print("Header:", get_unverified_header(token))
    # Test decoding with a mock PEM string
    key = "-----BEGIN PUBLIC KEY-----\nMIIBI...-----END PUBLIC KEY-----"
    jwt.decode(token, key, algorithms=["RS256"])
except Exception as e:
    print("Error:", repr(e))
