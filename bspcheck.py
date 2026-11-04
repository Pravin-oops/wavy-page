import inspect, importlib.metadata as md
from bsp_python_client.auth import bsp_authenticator as m
print("installed:", md.version("bsp_python_client"))
print("file:", m.__file__)
A = m.BSPAuthenticator
print("__init__", inspect.signature(A.__init__))
print(inspect.getsource(A.__init__))
print(inspect.getsource(A.get_token))
print(inspect.getsource(m.BamTokenProvider) if hasattr(m, "BamTokenProvider") else "no BamTokenProvider in module")
src = inspect.getsource(m)
for i, line in enumerate(src.splitlines(), 1):
    if any(t in line.lower() for t in ("environ", "getenv", "bam_url", "bam_name", "appname", "token_url")):
        print(f"{i}: {line.strip()}")