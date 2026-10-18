"""Fixed future foreground entry. Inert Source until a NEW reviewed assembly.

Do not execute this native entry in Source checks. The raw None template can
only return a closed refusal; Root's finite assembly supplies exact packet and
support-byte expectations. That derivation is still not execution admission.
"""

BOOTSTRAP_POLICY = {'format': 'eldion-l1-fixed-bootstrap-policy-r1', 'packet': {'bytes': 275358, 'sha256': 'ef79405f35d8df25afa19510ffcb88183e0a6438546b11433052b263f865b9ac'}, 'members': {'authority': {'bytes': 5866, 'sha256': '4e20a22f2856d40fe5d91e034c473af73e1e83c06e17af0ec0db12d725685cfb'}, 'entry_bindings': {'bytes': 257, 'sha256': 'a86a561191a0bd05d0474b185b7109522ee8a0e01450bad24770ca4dc579fb85'}, 'entry_contract': {'bytes': 4281, 'sha256': '34cdee5784aa912c700bf725e17440ce9a313031e79d6ee8a897cab7773c972b'}, 'finite_linux_resource': {'bytes': 10212, 'sha256': '5096576618c79961199016a4afeff16a22eff0c94c32db2ce3f6212939487286'}, 'guest_bootstrap_template': {'bytes': 2573, 'sha256': '1992f4fa309d53e5d0fd161137e94e56d1bfe9bd8ef88b7f67e0bf93a9a76480'}, 'guest_template': {'bytes': 54356, 'sha256': 'a5fd6e8afd1d0a9820d0c3af7a44f43ab6cda0c3f3a642cc4aad0007e2e8ed3d'}, 'host_io': {'bytes': 4984, 'sha256': 'a721868f4f9abd967e62021264bd348b0338420d82430baa1755e5744aaef943'}, 'linux_identity_release_leaf': {'bytes': 8107, 'sha256': 'de8bbe93a46a25f31e28b9a277f9da1dc8bffdd49e6d5fffa149dc9e838da99e'}, 'linux_resource_backend': {'bytes': 24314, 'sha256': 'adbc572386d0ca8c78c2a982550db03a76630f07d32441dd9f61d3c13a932287'}, 'linux_resource_native': {'bytes': 58295, 'sha256': 'd810fef19cdcea898b7e9bb1489f417e2ca9a228708c0a19f39260eec07fec8a'}, 'native_binding': {'bytes': 4323, 'sha256': '8bbcdee5e55692b55eb6e668b5fac9ffec9f6dafca1ca327efef46a52f857113'}, 'public_r5_resource': {'bytes': 9531, 'sha256': '148e5797c828c3a928a3d186cdcf2ebe0998b14ab6fa0e751b0032f9aa01db58'}, 'qualification_report': {'bytes': 11400, 'sha256': 'cce233997d33947050fa34488251bc808c074383438aea9b89439dc4fd88eb67'}, 'resource_binder': {'bytes': 3639, 'sha256': '3816df558ddef746e74ef91afe19b3ef6de7e20e71be6e4650e6970cae10390a'}, 'source_packet': {'bytes': 4072, 'sha256': '73db8ab66b3b0234d175120709969a67e292cde4ead7d8fde5ad406dd3130048'}}, 'support': (('entry_contract', b'"""Pure L1 entry selection. A matching record never grants native authority.\n\nNo imports, environment reads, process creation or native calls at import.\nThe reviewed entry must obtain a genuine live issuer separately; these values\nonly correlate that owner with the one future GitHub run.\n"""\n\nREPOSITORY = \'aladushka9180-droid/anatomy-trainer\'\nWORKFLOW_PATH = \'.github/workflows/eldion-report-export-isolated.yml\'\nBRANCH = \'codex/eldion-ci-resource-20261018-r1\'\nJOB = \'resource-l1\'\nINTERPRETER = \'/usr/bin/python3.12\'\nINTERPRETER_BYTES = 8020928\nINTERPRETER_SHA256 = \'e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f\'\nPRESERVED_ENV = (\n    \'GITHUB_REPOSITORY\', \'GITHUB_RUN_ID\', \'GITHUB_RUN_ATTEMPT\',\n    \'GITHUB_JOB\', \'GITHUB_SHA\', \'GITHUB_WORKFLOW_REF\',\n    \'GITHUB_WORKFLOW_SHA\', \'RUNNER_TRACKING_ID\',\n)\n\n\nclass EntryHold(RuntimeError):\n    def __init__(self, code):\n        self.code = code\n        super().__init__(\'L1_ENTRY_\' + code)\n\n\ndef need(value, code):\n    if not value:\n        raise EntryHold(code)\n\n\ndef sha_shape(value):\n    return (type(value) is str and len(value) == 40 and\n            all(c in \'0123456789abcdef\' for c in value))\n\n\ndef select_job_context(environment, expected_head):\n    """Select closed current-run identifiers, not an admission token.\n\n    The expected commit is the single exact input from Root\'s future dispatch.\n    Its equality to environment values still requires independent run/job\n    intake. Never return a boolean suggesting native authority was established.\n    """\n    need(type(environment) is dict, \'ENVIRONMENT_SHAPE\')\n    need(sha_shape(expected_head), \'EXPECTED_HEAD_UNBOUND\')\n    need(environment.get(\'GITHUB_REPOSITORY\') == REPOSITORY, \'REPOSITORY\')\n    need(environment.get(\'GITHUB_JOB\') == JOB, \'JOB\')\n    need(environment.get(\'GITHUB_RUN_ATTEMPT\') == \'1\', \'ATTEMPT\')\n    run_id = environment.get(\'GITHUB_RUN_ID\')\n    need(type(run_id) is str and 1 <= len(run_id) <= 20 and\n         run_id[0] in \'123456789\' and all(c in \'0123456789\' for c in run_id),\n         \'RUN_ID\')\n    need(environment.get(\'GITHUB_SHA\') == expected_head and\n         environment.get(\'GITHUB_WORKFLOW_SHA\') == expected_head, \'HEAD\')\n    workflow_ref = REPOSITORY + \'/\' + WORKFLOW_PATH + \'@refs/heads/\' + BRANCH\n    need(environment.get(\'GITHUB_WORKFLOW_REF\') == workflow_ref, \'WORKFLOW_REF\')\n    tracking = environment.get(\'RUNNER_TRACKING_ID\')\n    need(type(tracking) is str and 1 <= len(tracking) <= 256 and\n         all(33 <= ord(c) <= 126 for c in tracking), \'TRACKING_NOT_PRESERVED\')\n    return {\n        \'repository\': REPOSITORY, \'workflowPath\': WORKFLOW_PATH,\n        \'branch\': BRANCH, \'head\': expected_head, \'runId\': run_id,\n        \'runAttempt\': 1, \'jobKey\': JOB,\n    }\n\n\ndef fixed_root_command(bootstrap, expected_bootstrap_sha256, digest, expected_head=None):\n    """Describe one prospective root entry; this function never executes it.\n\n    Only the independently pinned fixed bootstrap may occupy -c. No shell,\n    source path, arbitrary program, preserved secrets or fallback is accepted.\n    The bootstrap\'s loader separately checks its finite input packet.\n    """\n    need(sha_shape(expected_head), \'EXPECTED_HEAD_UNBOUND\')\n    need(type(bootstrap) is bytes and 0 < len(bootstrap) <= 32768,\n         \'BOOTSTRAP_BOUND\')\n    need(type(expected_bootstrap_sha256) is str and\n         len(expected_bootstrap_sha256) == 64 and\n         all(c in \'0123456789abcdef\' for c in expected_bootstrap_sha256),\n         \'BOOTSTRAP_PIN\')\n    need(digest(bootstrap) == expected_bootstrap_sha256, \'BOOTSTRAP_DRIFT\')\n    try:\n        text = bootstrap.decode(\'ascii\')\n    except (UnicodeError, ValueError):\n        raise EntryHold(\'BOOTSTRAP_ASCII\') from None\n    need(\'\\x00\' not in text, \'BOOTSTRAP_NUL\')\n    return (\n        \'/usr/bin/sudo\', \'-n\', \'--preserve-env=\' + \',\'.join(PRESERVED_ENV),\n        \'--\', INTERPRETER, \'-I\', \'-S\', \'-B\', \'-c\', text, expected_head,\n    )\n\n\ndef source_status():\n    return {\n        \'format\': \'eldion-l1-entry-source-status-r1\',\n        \'sourceOnly\': True, \'actualNativeAdmission\': False,\n        \'sudoAvailabilityObservedInO0\': False,\n        \'rootEntryExecuted\': False, \'futureJobBindingAccepted\': False,\n        \'resourceAuthorityAccepted\': False,\n        \'nativeQualificationAccepted\': False,\n    }\n', '34cdee5784aa912c700bf725e17440ce9a313031e79d6ee8a897cab7773c972b'), ('source_packet', b'"""Finite source packet validation; never imports or executes packet members.\n\nExpected pins come from the separately reviewed entry literal, not the packet.\nImporting this module performs no IO and grants no native authority.\n"""\nimport base64\nimport binascii\nimport hashlib\nimport json\n\nPACKET_CAP = 1048576\nMEMBER_CAP = 262144\nMEMBER_COUNT_CAP = 16\n\n\nclass PacketHold(RuntimeError):\n    def __init__(self, code):\n        self.code = code\n        super().__init__(\'L1_SOURCE_PACKET_\' + code)\n\n\ndef need(value, code):\n    if not value:\n        raise PacketHold(code)\n\n\ndef canonical(value):\n    return json.dumps(value, separators=(\',\', \':\'), ensure_ascii=True).encode(\'ascii\')\n\n\ndef pairs(rows):\n    result = {}\n    for key, value in rows:\n        need(key not in result, \'DUPLICATE_KEY\')\n        result[key] = value\n    return result\n\n\ndef reject_constant(_):\n    raise PacketHold(\'NONFINITE\')\n\n\ndef pin_shape(pin, maximum):\n    return (type(pin) is dict and set(pin) == {\'bytes\', \'sha256\'} and\n            type(pin[\'bytes\']) is int and 0 < pin[\'bytes\'] <= maximum and\n            type(pin[\'sha256\']) is str and len(pin[\'sha256\']) == 64 and\n            all(c in \'0123456789abcdef\' for c in pin[\'sha256\']))\n\n\ndef matches(raw, pin):\n    return len(raw) == pin[\'bytes\'] and hashlib.sha256(raw).hexdigest() == pin[\'sha256\']\n\n\ndef validate_packet(raw, expected_packet, expected_members):\n    """Return verified inert bytes only, never a loaded issuer or permission."""\n    need(pin_shape(expected_packet, PACKET_CAP), \'EXPECTED_PACKET_UNBOUND\')\n    need(type(expected_members) is dict and 1 <= len(expected_members) <= MEMBER_COUNT_CAP,\n         \'EXPECTED_MEMBERS_UNBOUND\')\n    for name, pin in expected_members.items():\n        need(type(name) is str and 1 <= len(name) <= 64 and\n             all(c in \'abcdefghijklmnopqrstuvwxyz0123456789_.\' for c in name),\n             \'EXPECTED_MEMBER_NAME\')\n        need(pin_shape(pin, MEMBER_CAP), \'EXPECTED_MEMBER_PIN\')\n    need(type(raw) is bytes and 0 < len(raw) <= PACKET_CAP, \'SIZE\')\n    need(matches(raw, expected_packet), \'PACKET_PIN\')\n    try:\n        value = json.loads(raw.decode(\'ascii\'), object_pairs_hook=pairs,\n                           parse_constant=reject_constant)\n        need(canonical(value) == raw, \'CANONICAL\')\n        need(type(value) is dict and set(value) == {\'format\', \'members\'} and\n             value[\'format\'] == \'eldion-l1-source-packet-r1\', \'SCHEMA\')\n        members = value[\'members\']\n        need(type(members) is dict and set(members) == set(expected_members), \'MEMBER_SET\')\n        result = {}\n        for name, encoded in members.items():\n            need(type(encoded) is str and 0 < len(encoded) <= 4 * ((MEMBER_CAP + 2) // 3),\n                 \'MEMBER_ENCODING_BOUND\')\n            source = base64.b64decode(encoded, validate=True)\n            need(base64.b64encode(source).decode(\'ascii\') == encoded, \'MEMBER_BASE64\')\n            need(matches(source, expected_members[name]), \'MEMBER_PIN\')\n            result[name] = source\n        return result\n    except PacketHold:\n        raise\n    except (UnicodeError, ValueError, TypeError, RecursionError, OverflowError,\n            binascii.Error):\n        raise PacketHold(\'DECODE\') from None\n\n\ndef read_exact_packet(stream, expected_packet, expected_members):\n    """Read fixed reviewed byte count and one EOF byte from the private input.\n\n    No source executes here. A blocked read is not interrupted by a claimed\n    deadline; future provider timeout/disposal remains HOLD, never retirement.\n    This outer source-input stream is separate from the guest CANCEL stream.\n    """\n    need(pin_shape(expected_packet, PACKET_CAP), \'EXPECTED_PACKET_UNBOUND\')\n    chunks = []\n    remaining = expected_packet[\'bytes\']\n    while remaining:\n        part = stream.read(min(remaining, 65536))\n        need(type(part) is bytes and 0 < len(part) <= remaining, \'TRUNCATED\')\n        chunks.append(part)\n        remaining -= len(part)\n    need(stream.read(1) == b\'\', \'EXTRA_INPUT\')\n    return validate_packet(b\'\'.join(chunks), expected_packet, expected_members)\n', '73db8ab66b3b0234d175120709969a67e292cde4ead7d8fde5ad406dd3130048'), ('native_binding', b'"""Pure finite compiler for one future verified Root source packet.\n\nThis is code input preparation, not native admission. It cannot create an\nissuer, import the native implementation, execute its output or grant rights.\n"""\nimport hashlib\nimport json\n\nfrom entry_contract import (\n    INTERPRETER, INTERPRETER_BYTES, INTERPRETER_SHA256,\n    PRESERVED_ENV, select_job_context,\n)\n\nMEMBERS = frozenset((\n    \'authority\', \'entry_contract\', \'source_packet\', \'native_binding\',\n    \'linux_resource_native\', \'finite_linux_resource\', \'resource_binder\',\n    \'guest_bootstrap_template\', \'guest_template\', \'entry_bindings\', \'host_io\',\n    \'qualification_report\', \'linux_identity_release_leaf\',\n    \'public_r5_resource\', \'linux_resource_backend\',\n))\nGUEST_SHA256 = \'a5fd6e8afd1d0a9820d0c3af7a44f43ab6cda0c3f3a642cc4aad0007e2e8ed3d\'\nSTAGE_MODULES = (\n    (\'public_r5_resource\', \'opt/eldion-held-copy-resource-source-20261014-r1/public_r5_resource.py\',\n     9531, \'148e5797c828c3a928a3d186cdcf2ebe0998b14ab6fa0e751b0032f9aa01db58\'),\n    (\'linux_resource_backend\', \'opt/eldion-held-copy-resource-source-20261014-r1/linux_resource_backend.py\',\n     24314, \'adbc572386d0ca8c78c2a982550db03a76630f07d32441dd9f61d3c13a932287\'),\n)\nSENTINEL = b\'COMPILED_BINDING = None\\n\'\n\n\nclass BindingHold(RuntimeError):\n    def __init__(self, code):\n        self.code = code\n        super().__init__(\'L1_BINDING_\' + code)\n\n\ndef need(value, code):\n    if not value:\n        raise BindingHold(code)\n\n\ndef digest(raw):\n    return hashlib.sha256(raw).hexdigest()\n\n\ndef compile_native_binding(members, expected_packet_sha256, environment, expected_head):\n    """Consume only a packet already independently pin-validated by the loader.\n\n    The returned expectations carry current correlation data, never authority\n    booleans. The genuine issuer still measures and owns every native resource.\n    RUNNER_TRACKING_ID stays private in memory/the owned stage; do not log this\n    return value, its repr, source derivatives or exception locals.\n    """\n    need(type(members) is dict and set(members) == MEMBERS, \'CLOSED_MEMBERS\')\n    need(all(type(raw) is bytes and 0 < len(raw) <= 262144\n             for raw in members.values()), \'MEMBER_BYTES\')\n    need(type(expected_packet_sha256) is str and len(expected_packet_sha256) == 64 and\n         all(c in \'0123456789abcdef\' for c in expected_packet_sha256), \'PACKET_PIN\')\n    select_job_context(environment, expected_head)\n    need(digest(members[\'guest_template\']) == GUEST_SHA256, \'ORIGINAL_GUEST_PIN\')\n    staged = []\n    for name, path, size, sha256 in STAGE_MODULES:\n        raw = members[name]\n        need(len(raw) == size and digest(raw) == sha256, \'ORIGINAL_STAGE_MODULE_PIN\')\n        staged.append((path, raw, sha256))\n    job = tuple((name, environment[name]) for name in PRESERVED_ENV)\n    component = \'eldion-resource-\' + digest(\n        json.dumps(job, separators=(\',\', \':\'), ensure_ascii=True).encode(\'ascii\'))[:24]\n    return {\n        \'format\': \'eldion-linux-resource-compiled-binding-r1\',\n        \'authoritySha256\': digest(members[\'authority\']),\n        \'packetSha256\': expected_packet_sha256,\n        \'interpreter\': (INTERPRETER, INTERPRETER_BYTES, INTERPRETER_SHA256),\n        \'job\': job,\n        \'sources\': tuple((name, members[name], digest(members[name])) for name in sorted(MEMBERS)),\n        \'stageModules\': tuple(staged),\n        \'guestTemplate\': members[\'guest_template\'],\n        \'bootstrapTemplate\': members[\'guest_bootstrap_template\'],\n        \'stageParent\': \'/tmp\', \'stageName\': component, \'cgroupName\': component,\n        \'wrapperModule\': \'finite_linux_resource\',\n    }\n\n\ndef bind_native_template(template, compiled_binding):\n    """Change exactly one reviewed sentinel; return bytes and private SHA only.\n\n    No native code executes here. The issuer independently reconstructs this\n    same derivative from its raw pinned template and exact compiled binding.\n    """\n    need(type(template) is bytes and template.count(SENTINEL) == 1,\n         \'NATIVE_SENTINEL\')\n    need(type(compiled_binding) is dict, \'BINDING_SHAPE\')\n    replacement = (\'COMPILED_BINDING = \' + repr(compiled_binding) + \'\\n\').encode(\'ascii\')\n    bound = template.replace(SENTINEL, replacement, 1)\n    need(bound.replace(replacement, SENTINEL, 1) == template, \'NATIVE_RAW_INVERSE\')\n    return bound, digest(bound)\n', '8bbcdee5e55692b55eb6e668b5fac9ffec9f6dafca1ca327efef46a52f857113'))}


def run_resource_root_entry():
    if BOOTSTRAP_POLICY is None:
        return {'format': 'eldion-l1-root-entry-r1',
                'status': 'NOT_ADMITTED_UNBOUND', 'nativeImports': 0,
                'nativeQualificationAccepted': False, 'runtimeAccepted': False}

    # Only the separately admitted fixed bootstrap reaches this boundary.
    import hashlib
    import json
    import os
    import sys
    import time
    import types

    owner = None
    caller = None
    output_attempted = False
    source_stage = 'FIXED_ENTRY'
    bound_native_sha256 = None
    private_sources = []

    def load(name, raw):
        if name in sys.modules or type(raw) is not bytes:
            raise RuntimeError('L1_FIXED_MODULE_UNPROVEN')
        module = types.ModuleType(name)
        module.__file__ = '<sealed-l1:' + name + '>'
        sys.modules[name] = module
        private_sources.append((name, module))
        exec(compile(raw, module.__file__, 'exec'), module.__dict__)
        return module

    def emit(receipt):
        nonlocal output_attempted
        if output_attempted:
            return False
        output_attempted = True
        try:
            data = json.dumps(receipt, separators=(',', ':'),
                              ensure_ascii=True).encode('ascii') + b'\n'
            if not 0 < len(data) <= 98304:
                return False
            return os.write(1, data) == len(data)
        except BaseException:
            return False

    try:
        if (sys.platform != 'linux' or os.getuid() != 0 or os.geteuid() != 0
                or len(sys.argv) != 2):
            raise RuntimeError('L1_FIXED_PLATFORM_OR_ARGUMENTS')
        policy = BOOTSTRAP_POLICY
        if (type(policy) is not dict or set(policy) !=
                {'format', 'packet', 'members', 'support'} or
                policy['format'] != 'eldion-l1-fixed-bootstrap-policy-r1'):
            raise RuntimeError('L1_FIXED_POLICY_UNBOUND')
        support = policy['support']
        if type(support) is not tuple or tuple(x[0] for x in support) != (
                'entry_contract', 'source_packet', 'native_binding'):
            raise RuntimeError('L1_FIXED_SUPPORT_SET')
        loaded = {}
        for name, raw, sha256 in support:
            if (type(raw) is not bytes or not 0 < len(raw) <= 16384 or
                    hashlib.sha256(raw).hexdigest() != sha256):
                raise RuntimeError('L1_FIXED_SUPPORT_PIN')
            loaded[name] = load(name, raw)
        contract = loaded['entry_contract']
        expected_head = sys.argv[1]
        # Read only the closed correlation fields. Never log their values.
        environment = {key: os.environ.get(key) for key in contract.PRESERVED_ENV}
        context = contract.select_job_context(environment, expected_head)
        source_stage = 'SOURCE_PACKET'
        members = loaded['source_packet'].read_exact_packet(
            sys.stdin.buffer, policy['packet'], policy['members'])
        for name, raw, _ in support:
            if members[name] != raw:
                raise RuntimeError('L1_FIXED_SUPPORT_PACKET_DRIFT')
        compiler = loaded['native_binding']
        binding = compiler.compile_native_binding(
            members, policy['packet']['sha256'], environment, expected_head)
        bound_native, bound_native_sha256 = compiler.bind_native_template(
            members['linux_resource_native'], binding)
        source_stage = 'PINNED_MODULES'
        for name in ('entry_bindings', 'resource_binder', 'qualification_report',
                     'linux_identity_release_leaf', 'host_io', 'finite_linux_resource'):
            loaded[name] = load(name, members[name])
        native = load('linux_resource_native', bound_native)
        # Factory is Source-contracted inert; prepare happens only after Root
        # retains its exact original issuer object, inside the paired caller.
        owner = native.create_compiled_resource_issuer()
        source_stage = 'SAME_OWNER_RESOURCE_CALLER'
        caller = loaded['finite_linux_resource'].run_with_trusted_issuer(owner)
        caller_state = caller.state()
        native_state = owner.state()
        receipt = {
            'format': 'eldion-l1-root-native-evidence-r2',
            'status': ('COMPLETE_REQUIRES_INDEPENDENT_ROOT_INTAKE'
                       if caller_state.get('status') == 'COMPLETE_REQUIRES_ROOT_INTAKE'
                       and caller_state.get('ownerReleased') is True else 'HOLD'),
            'jobContext': context,
            'packetSha256': policy['packet']['sha256'],
            'boundNativeSha256': bound_native_sha256,
            'caller': caller_state, 'native': native_state,
            'guestReport': capture_guest_evidence(caller),
            'publicReceiptBytesMaximum': 98304,
            'nativeQualificationAccepted': False, 'runtimeAccepted': False,
            'applicationStandAccepted': False,
        }
        delivered = emit(receipt)
        if (delivered and receipt['status'] ==
                'COMPLETE_REQUIRES_INDEPENDENT_ROOT_INTAKE'):
            return receipt
    except BaseException:
        # Do not export exception text, locals, packet or private compiled
        # binding/source contents (including the preserved tracking value).
        emit({'format': 'eldion-l1-root-native-evidence-r2', 'status': 'HOLD',
              'stage': source_stage, 'ownerReturned': owner is not None,
              'callerReturned': caller is not None,
              'nativeQualificationAccepted': False, 'runtimeAccepted': False,
              'automaticRetry': False})

    if owner is None:
        # The inert factory has no pre-return resources. No second owner or
        # fallback is constructed. Refusal is not native retirement proof.
        return {'format': 'eldion-l1-root-entry-r1', 'status': 'HOLD_BEFORE_OWNER',
                'nativeQualificationAccepted': False, 'runtimeAccepted': False}
    # The exact same objects/stack remain alive. Drain only already-owned IO;
    # never start another scenario, retry an uncertain close or force cleanup.
    # Finite CI cancellation/disposal may end custody: that is HOLD, not proof.
    while True:
        try:
            if caller is not None:
                caller.advance(0)
        except BaseException:
            pass
        try:
            time.sleep(1)
        except BaseException:
            pass

def capture_guest_evidence(caller):
    """Copy only the bounded owned guest pipe and finite four-field context.

    This pure copy does not classify, release resources or confer authority.
    The future independent intake must decode and classify these exact bytes
    and correlate their own-resource facts with the separate native receipt.
    """
    import base64
    import hashlib

    if type(caller.report) not in (bytes, bytearray) or len(caller.report) > 65536:
        raise RuntimeError('L1_GUEST_EVIDENCE_REPORT_BOUND')
    raw = bytes(caller.report)
    context = None
    run_id = None
    guest_sha256 = None
    if caller.plan is not None:
        plan = caller.plan
        keys = ('standResourceId', 'wrapperSourceSha256', 'stageRoot', 'scenario')
        if (type(plan) is not dict or type(plan.get('context')) is not dict
                or set(plan['context']) != set(keys)):
            raise RuntimeError('L1_GUEST_EVIDENCE_CONTEXT')
        context = {key: plan['context'][key] for key in keys}
        if any(type(value) is not str or not value.isascii() or
               not 1 <= len(value) <= 1024 or '\x00' in value
               for value in context.values()):
            raise RuntimeError('L1_GUEST_EVIDENCE_CONTEXT_BOUND')
        run_id, guest_sha256 = plan.get('runId'), plan.get('guestSha256')
        if (context['scenario'] != 'success_retirement'
                or type(run_id) is not str or len(run_id) != 32
                or type(guest_sha256) is not str or len(guest_sha256) != 64
                or any(c not in '0123456789abcdef' for c in run_id + guest_sha256)):
            raise RuntimeError('L1_GUEST_EVIDENCE_PLAN_PIN')
    return {
        'format': 'eldion-l1-owned-guest-report-r1', 'bytes': len(raw),
        'sha256': hashlib.sha256(raw).hexdigest(),
        'base64': base64.b64encode(raw).decode('ascii'),
        'context': context, 'runId': run_id, 'guestSha256': guest_sha256,
        'requiresIndependentClassification': True,
        'nativeQualificationAccepted': False,
    }

run_resource_root_entry()
