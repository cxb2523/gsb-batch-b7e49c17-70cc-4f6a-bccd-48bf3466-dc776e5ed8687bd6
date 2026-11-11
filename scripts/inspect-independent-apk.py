"""Read APK metadata and narrowly selected DEX constants; never execute APK code."""
import argparse
import hashlib
import json
import re
import struct
import zipfile
from pathlib import Path


def uleb(data, offset):
    value, shift = 0, 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, offset
        shift += 7
        if shift > 35:
            raise ValueError('Invalid DEX ULEB')


def dex_info(data):
    def uint(offset):
        return struct.unpack_from('<I', data, offset)[0]

    strings = []
    for index in range(uint(56)):
        offset = uint(uint(60) + 4 * index)
        _, start = uleb(data, offset)
        end = data.index(0, start)
        strings.append(data[start:end].decode('utf-8', 'replace'))
    types = [strings[uint(uint(68) + 4 * index)] for index in range(uint(64))]
    methods = []
    for index in range(uint(88)):
        class_index, _, name_index = struct.unpack_from('<HHI', data, uint(92) + index * 8)
        methods.append((types[class_index], strings[name_index]))
    def encoded_value(offset):
        header = data[offset]
        offset += 1
        kind, count = header & 31, (header >> 5) + 1
        if kind == 0x1e:
            return None, offset
        if kind == 0x1f:
            return bool(header >> 5), offset
        if kind == 0x1c:
            size, offset = uleb(data, offset)
            values = []
            for _ in range(size):
                value, offset = encoded_value(offset)
                values.append(value)
            return values, offset
        if kind == 0x1d:
            return annotation(offset)
        number = int.from_bytes(data[offset:offset + count], 'little')
        offset += count
        if kind == 0x17:
            return strings[number], offset
        if kind == 0x18:
            return types[number], offset
        return number, offset

    def annotation(offset):
        type_index, offset = uleb(data, offset)
        size, offset = uleb(data, offset)
        values = {}
        for _ in range(size):
            name_index, offset = uleb(data, offset)
            value, offset = encoded_value(offset)
            values[strings[name_index]] = value
        return {'type': types[type_index], 'values': values}, offset

    def annotation_set(offset):
        if not offset:
            return []
        return [annotation(uint(offset + 4 + 4 * i) + 1)[0] for i in range(uint(offset))]

    endpoint_methods = []
    for index in range(uint(96)):
        class_offset = uint(100) + 32 * index
        directory = uint(class_offset + 20)
        if not directory:
            continue
        field_count, method_count, parameter_count = (uint(directory + p) for p in (4, 8, 12))
        method_annotations = {}
        for pos in range(method_count):
            method_index, annotation_offset = struct.unpack_from('<II', data, directory + 16 + 8 * field_count + 8 * pos)
            method_annotations[method_index] = annotation_set(annotation_offset)
        for method_index, annotations in method_annotations.items():
            paths = [a for a in annotations if any(isinstance(v, str) and v.startswith('/reading/') and re.search(r'search|bookmall|category', v) for v in a['values'].values())]
            if not paths:
                continue
            params = []
            for pos in range(parameter_count):
                param_method, ref_offset = struct.unpack_from('<II', data, directory + 16 + 8 * (field_count + method_count + pos))
                if param_method == method_index:
                    for param_index in range(uint(ref_offset)):
                        params.append(annotation_set(uint(ref_offset + 4 + 4 * param_index)))
            endpoint_methods.append({'class': methods[method_index][0], 'method': methods[method_index][1], 'annotations': paths, 'parameters': params})
    getters = []
    for index in range(uint(96)):
        class_offset = uint(100) + 32 * index
        offset = uint(class_offset + 24)
        if not offset:
            continue
        counts = []
        for _ in range(4):
            value, offset = uleb(data, offset)
            counts.append(value)
        for _ in range(counts[0] + counts[1]):
            _, offset = uleb(data, offset)
            _, offset = uleb(data, offset)
        for method_count in counts[2:]:
            method_index = 0
            for _ in range(method_count):
                delta, offset = uleb(data, offset)
                method_index += delta
                _, offset = uleb(data, offset)
                code_offset, offset = uleb(data, offset)
                class_name, method_name = methods[method_index]
                if not code_offset or method_name not in {'getAid', 'getAppId', 'getAppName', 'getPackageName', 'getVersionCode', 'getVersionName'}:
                    continue
                # Short getter instruction words are evidence to inspect, not a disassembly.
                word_count = uint(code_offset + 12)
                if word_count > 64:
                    continue
                words = list(struct.unpack_from('<' + 'H' * word_count, data, code_offset + 16))
                literals = []
                for pos, word in enumerate(words):
                    opcode = word & 255
                    if opcode == 0x13 and pos + 1 < len(words):
                        literals.append({'possibleInt16': struct.unpack('<h', struct.pack('<H', words[pos + 1]))[0]})
                    elif opcode == 0x14 and pos + 2 < len(words):
                        literals.append({'possibleInt32': struct.unpack('<i', struct.pack('<HH', words[pos + 1], words[pos + 2]))[0]})
                    elif opcode == 0x1a and pos + 1 < len(words) and words[pos + 1] < len(strings):
                        value = strings[words[pos + 1]]
                        if re.fullmatch(r'[A-Za-z0-9._-]{1,70}', value):
                            literals.append({'possibleString': value})
                if literals:
                    getters.append({'class': class_name, 'method': method_name, 'codeWords': words, 'possibleLiterals': literals})
    paths = sorted({value for value in strings if re.fullmatch(r'/(?:reading|novel|api|search)/[A-Za-z0-9_./-]{3,160}', value) and re.search(r'comic|video|feed|search|bookmall|category|homepage|rank', value)})
    markers = sorted({value for value in strings if re.fullmatch(r'[A-Za-z0-9_./-]{1,100}', value) and re.search(r'comic_series_|kylin|comic.*tab|tab.*comic|novelread', value)})
    # Only retain domain names, excluding query strings, tokens and device identifiers.
    hosts = sorted({host for value in strings for host in re.findall(r'(?:https?://)?((?:api\d*[-a-z]*|reading|kylin)[a-z0-9.-]*\.(?:com|net))', value) if 'fqnovel' in host or 'hainanyuyue' in host or 'snssdk' in host})
    return {'strings': len(strings), 'getters': getters, 'apiPaths': paths, 'endpointMethods': endpoint_methods, 'markers': markers, 'hosts': hosts}


parser = argparse.ArgumentParser()
parser.add_argument('--apk', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
apk_path = Path(args.apk)
report = {'apk': str(apk_path), 'sha256': hashlib.sha256(apk_path.read_bytes()).hexdigest(), 'executed': False, 'dex': []}
with zipfile.ZipFile(apk_path) as archive:
    for name in archive.namelist():
        if re.fullmatch(r'classes\d*\.dex', name):
            report['dex'].append({'file': name, **dex_info(archive.read(name))})
    report['configurationAssets'] = [name for name in archive.namelist() if name.startswith('assets/') and re.search(r'config|settings|manifest|app_info|channel', name, re.I)][:100]
output_path = Path(args.output)
output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'sha256': report['sha256'], 'dexCount': len(report['dex']), 'output': str(output_path)}))
