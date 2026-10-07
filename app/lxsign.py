from __future__ import annotations

import hashlib
import os
import zipfile
from pathlib import Path

PUBLIC_KEY = "0271846c4fa9e6b47bd2b2fc89dd282e30531abe9ce1b8d522b44836761a1131"
SIG_NAME = "signature.sig"

_P = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_D = (-121665 * pow(121666, _P - 2, _P)) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _inv(x: int) -> int:
    return pow(x, _P - 2, _P)


def _xrecover(y: int) -> int:
    xx = (y * y - 1) * _inv(_D * y * y + 1)
    x = pow(xx, (_P + 3) // 8, _P)
    if (x * x - xx) % _P:
        x = (x * _I) % _P
    if x % 2:
        x = _P - x
    return x


_BY = (4 * _inv(5)) % _P
_B = (_xrecover(_BY), _BY, 1, (_xrecover(_BY) * _BY) % _P)


def _add(p, q):
    x1, y1, z1, t1 = p
    x2, y2, z2, t2 = q
    a = (y1 - x1) * (y2 - x2) % _P
    b = (y1 + x1) * (y2 + x2) % _P
    c = 2 * t1 * t2 * _D % _P
    d = 2 * z1 * z2 % _P
    e, f, g, h = b - a, d - c, d + c, b + a
    return e * f % _P, g * h % _P, f * g % _P, e * h % _P


def _mul(p, e: int):
    q = (0, 1, 1, 0)
    while e:
        if e & 1:
            q = _add(q, p)
        p = _add(p, p)
        e >>= 1
    return q


def _encode(p) -> bytes:
    x, y, z, _ = p
    zi = _inv(z)
    x, y = x * zi % _P, y * zi % _P
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def _decode(s: bytes):
    y = int.from_bytes(s, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    if y >= _P:
        raise ValueError("ponto invalido")
    x = _xrecover(y)
    if x & 1 != sign:
        x = _P - x
    if (-x * x + y * y - 1 - _D * x * x * y * y) % _P:
        raise ValueError("ponto invalido")
    return x, y, 1, x * y % _P


def _h(*parts: bytes) -> bytes:
    return hashlib.sha512(b"".join(parts)).digest()


def _secret(seed: bytes):
    h = _h(seed)
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return a, h[32:]


def public_key(seed: bytes) -> bytes:
    a, _ = _secret(seed)
    return _encode(_mul(_B, a))


def sign(msg: bytes, seed: bytes) -> bytes:
    a, prefix = _secret(seed)
    pk = _encode(_mul(_B, a))
    r = int.from_bytes(_h(prefix, msg), "little") % _L
    rp = _encode(_mul(_B, r))
    k = int.from_bytes(_h(rp, pk, msg), "little") % _L
    s = (r + k * a) % _L
    return rp + s.to_bytes(32, "little")


def verify(msg: bytes, sig: bytes, pk: bytes) -> bool:
    if len(sig) != 64 or len(pk) != 32:
        return False
    try:
        rp, a = _decode(sig[:32]), _decode(pk)
    except ValueError:
        return False
    s = int.from_bytes(sig[32:], "little")
    if s >= _L:
        return False
    k = int.from_bytes(_h(sig[:32], pk, msg), "little") % _L
    return _encode(_mul(_B, s)) == _encode(_add(rp, _mul(a, k)))


def digest(zpath: Path) -> bytes:
    h = hashlib.sha256()
    with zipfile.ZipFile(zpath) as z:
        for n in sorted(z.namelist()):
            if n == SIG_NAME or n.endswith("/"):
                continue
            h.update(n.encode("utf-8") + b"\0" + hashlib.sha256(z.read(n)).digest())
    return h.digest()


def status(zpath: Path) -> str:
    try:
        with zipfile.ZipFile(zpath) as z:
            if SIG_NAME not in z.namelist():
                return "none"
            sig = bytes.fromhex(z.read(SIG_NAME).decode("ascii").strip())
    except Exception:
        return "bad"
    try:
        return "ok" if verify(digest(zpath), sig, bytes.fromhex(PUBLIC_KEY)) else "bad"
    except Exception:
        return "bad"


def is_signed(zpath: Path) -> bool:
    return status(zpath) == "ok"


def sign_zip(zpath: Path, seed: bytes) -> None:
    tmp = zpath.with_suffix(zpath.suffix + ".tmp")
    with zipfile.ZipFile(zpath) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zout:
        for item in zin.infolist():
            if item.filename != SIG_NAME:
                zout.writestr(item, zin.read(item.filename))
    sig = sign(digest(tmp), seed)
    with zipfile.ZipFile(tmp, "a") as z:
        z.writestr(SIG_NAME, sig.hex())
    os.replace(tmp, zpath)


def key_paths() -> list[Path]:
    out = []
    env = os.environ.get("LUDRIX_SIGN_KEY")
    if env:
        out.append(Path(env))
    out.append(Path.home() / ".ludrix" / "ludrix-sign.key")
    out.append(Path(__file__).resolve().parent.parent.parent / "chave" / "ludrix-sign.key")
    return out


def load_seed() -> bytes | None:
    for p in key_paths():
        try:
            if p.is_file():
                seed = bytes.fromhex(p.read_text(encoding="utf-8").strip())
                if len(seed) == 32:
                    return seed
        except Exception:
            continue
    return None
