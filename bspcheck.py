python -m pip show -f bsp_python_client

python -c "import inspect; from bsp_python_client.auth.bsp_authenticator import BSPAuthenticator as B; print(inspect.getsourcefile(B)); print([n for n in dir(B) if not n.startswith('__')])"

python -c "import pathlib,re,bsp_python_client as b; root=pathlib.Path(list(b.__path__)[0]); [print(f'{p.relative_to(root)}:{i}: {l.strip()}') for p in root.rglob('*.py') for i,l in enumerate(p.read_text(errors='ignore').splitlines(),1) if re.search(r'oauth_cb|error_cb|confluent_kafka|Producer\(|\.produce\(|\.flush\(|def get_config|def get_token|requests\.|bam_url|bam_name',l)]"

python -c "from bsp_python_client.auth.bsp_authenticator import BSPAuthenticator as B; c=B().get_config('utility/bsp_sit_config.yaml',{},'producer'); s=('pass','secret','token','key','user','jaas','cred','oauth'); [print(k,'=','<callable '+getattr(v,'__module__','?')+'.'+getattr(v,'__qualname__',type(v).__name__)+'>' if callable(v) else '<redacted>' if any(x in k.lower() for x in s) else v) for k,v in sorted(c.items())]"

python -c "import inspect; from bsp_python_client.auth.bsp_authenticator import BSPAuthenticator as B; print(inspect.getsource(B))"