#!/usr/bin/env python3
"""Split the separately named dice meshes in a GLB into self-contained GLBs."""

from __future__ import annotations

import argparse
import copy
import json
import re
import struct
from pathlib import Path
from typing import Any


PALETTES = ("Red", "Silver", "TieDye", "White", "Yellow")
SIDES = (4, 6, 8, 10, 12, 20)
GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def align4(length: int) -> int:
    return (length + 3) & ~3


def read_glb(path: Path) -> tuple[dict[str, Any], bytes]:
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError(f"{path} is too short to be a GLB.")
    magic, version, declared_length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC or version != 2 or declared_length != len(data):
        raise ValueError(f"{path} is not a valid GLB 2.0 file.")

    cursor = 12
    document: dict[str, Any] | None = None
    binary: bytes | None = None
    while cursor < len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, cursor)
        cursor += 8
        chunk = data[cursor:cursor + chunk_length]
        if len(chunk) != chunk_length:
            raise ValueError("The GLB contains a truncated chunk.")
        cursor += chunk_length
        if chunk_type == JSON_CHUNK:
            document = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
        elif chunk_type == BIN_CHUNK:
            binary = chunk

    if document is None or binary is None:
        raise ValueError("The GLB must contain JSON and binary chunks.")
    if len(binary) < document["buffers"][0]["byteLength"]:
        raise ValueError("The GLB binary chunk is shorter than its buffer declaration.")
    return document, binary


class SingleMeshExporter:
    def __init__(self, source: dict[str, Any], binary: bytes):
        self.source = source
        self.source_binary = binary
        self.binary = bytearray()
        self.buffer_views: list[dict[str, Any]] = []
        self.accessors: list[dict[str, Any]] = []
        self.materials: list[dict[str, Any]] = []
        self.textures: list[dict[str, Any]] = []
        self.images: list[dict[str, Any]] = []
        self.samplers: list[dict[str, Any]] = []
        self.view_map: dict[int, int] = {}
        self.accessor_map: dict[int, int] = {}
        self.material_map: dict[int, int] = {}
        self.texture_map: dict[int, int] = {}
        self.image_map: dict[int, int] = {}
        self.sampler_map: dict[int, int] = {}

    def add_buffer_view(self, source_index: int) -> int:
        if source_index in self.view_map:
            return self.view_map[source_index]

        source_view = self.source["bufferViews"][source_index]
        source_buffer = source_view.get("buffer", 0)
        if source_buffer != 0:
            raise ValueError("External buffers are not supported by this extractor.")

        source_offset = source_view.get("byteOffset", 0)
        source_length = source_view["byteLength"]
        start = len(self.binary)
        aligned_start = align4(start)
        self.binary.extend(b"\0" * (aligned_start - start))
        self.binary.extend(self.source_binary[source_offset:source_offset + source_length])

        view = copy.deepcopy(source_view)
        view["buffer"] = 0
        view["byteOffset"] = aligned_start
        target_index = len(self.buffer_views)
        self.buffer_views.append(view)
        self.view_map[source_index] = target_index
        return target_index

    def add_accessor(self, source_index: int) -> int:
        if source_index in self.accessor_map:
            return self.accessor_map[source_index]

        accessor = copy.deepcopy(self.source["accessors"][source_index])
        if "bufferView" in accessor:
            accessor["bufferView"] = self.add_buffer_view(accessor["bufferView"])
        if "sparse" in accessor:
            sparse = accessor["sparse"]
            sparse["indices"]["bufferView"] = self.add_buffer_view(sparse["indices"]["bufferView"])
            sparse["values"]["bufferView"] = self.add_buffer_view(sparse["values"]["bufferView"])

        target_index = len(self.accessors)
        self.accessors.append(accessor)
        self.accessor_map[source_index] = target_index
        return target_index

    def add_image(self, source_index: int) -> int:
        if source_index in self.image_map:
            return self.image_map[source_index]

        image = copy.deepcopy(self.source["images"][source_index])
        if "bufferView" in image:
            image["bufferView"] = self.add_buffer_view(image["bufferView"])
        elif "uri" not in image:
            raise ValueError(f"Image {source_index} has no URI or bufferView.")

        target_index = len(self.images)
        self.images.append(image)
        self.image_map[source_index] = target_index
        return target_index

    def add_sampler(self, source_index: int) -> int:
        if source_index in self.sampler_map:
            return self.sampler_map[source_index]
        target_index = len(self.samplers)
        self.samplers.append(copy.deepcopy(self.source["samplers"][source_index]))
        self.sampler_map[source_index] = target_index
        return target_index

    def add_texture(self, source_index: int) -> int:
        if source_index in self.texture_map:
            return self.texture_map[source_index]

        texture = copy.deepcopy(self.source["textures"][source_index])
        if "source" in texture:
            texture["source"] = self.add_image(texture["source"])
        if "sampler" in texture:
            texture["sampler"] = self.add_sampler(texture["sampler"])
        for extension in texture.get("extensions", {}).values():
            if "source" in extension:
                extension["source"] = self.add_image(extension["source"])

        target_index = len(self.textures)
        self.textures.append(texture)
        self.texture_map[source_index] = target_index
        return target_index

    def add_material(self, source_index: int) -> int:
        if source_index in self.material_map:
            return self.material_map[source_index]

        material = copy.deepcopy(self.source["materials"][source_index])

        def remap_texture_info(value: Any, parent_key: str = "") -> None:
            if isinstance(value, dict):
                if parent_key.endswith("Texture") and "index" in value:
                    value["index"] = self.add_texture(value["index"])
                for key, child in value.items():
                    remap_texture_info(child, key)
            elif isinstance(value, list):
                for child in value:
                    remap_texture_info(child, parent_key)

        remap_texture_info(material)
        target_index = len(self.materials)
        self.materials.append(material)
        self.material_map[source_index] = target_index
        return target_index

    def export(self, node_index: int, destination: Path) -> None:
        node = copy.deepcopy(self.source["nodes"][node_index])
        mesh = copy.deepcopy(self.source["meshes"][node["mesh"]])
        node["mesh"] = 0

        for primitive in mesh["primitives"]:
            primitive["attributes"] = {
                semantic: self.add_accessor(accessor_index)
                for semantic, accessor_index in primitive["attributes"].items()
            }
            if "indices" in primitive:
                primitive["indices"] = self.add_accessor(primitive["indices"])
            if "material" in primitive:
                primitive["material"] = self.add_material(primitive["material"])
            for target in primitive.get("targets", []):
                for semantic, accessor_index in target.items():
                    target[semantic] = self.add_accessor(accessor_index)

        document: dict[str, Any] = {
            "asset": copy.deepcopy(self.source["asset"]),
            "scene": 0,
            "scenes": [{"name": f"{node.get('name', 'Dice')} scene", "nodes": [0]}],
            "nodes": [node],
            "meshes": [mesh],
            "accessors": self.accessors,
            "bufferViews": self.buffer_views,
            "buffers": [{"byteLength": len(self.binary)}],
            "materials": self.materials,
            "textures": self.textures,
            "images": self.images,
            "samplers": self.samplers,
        }
        if "extensionsUsed" in self.source:
            document["extensionsUsed"] = copy.deepcopy(self.source["extensionsUsed"])
        if "extensionsRequired" in self.source:
            document["extensionsRequired"] = copy.deepcopy(self.source["extensionsRequired"])
        if "extensions" in self.source:
            document["extensions"] = copy.deepcopy(self.source["extensions"])

        write_glb(document, bytes(self.binary), destination)


def write_glb(document: dict[str, Any], binary: bytes, destination: Path) -> None:
    json_chunk = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * (align4(len(json_chunk)) - len(json_chunk))
    padded_binary = binary + b"\0" * (align4(len(binary)) - len(binary))
    total_length = 12 + 8 + len(json_chunk) + 8 + len(padded_binary)
    with destination.open("wb") as output:
        output.write(struct.pack("<III", GLB_MAGIC, 2, total_length))
        output.write(struct.pack("<II", len(json_chunk), JSON_CHUNK))
        output.write(json_chunk)
        output.write(struct.pack("<II", len(padded_binary), BIN_CHUNK))
        output.write(padded_binary)


def main() -> None:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=project_root / "public/assets/dice/dnd_dice_set.glb",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=project_root / "public/assets/dice/sets",
    )
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    source, binary = read_glb(args.source)
    pattern = re.compile(r"^(10|12|20|4|6|8)(Red|Silver|TieDye|White|Yellow)", re.IGNORECASE)
    selected: list[tuple[int, str, int]] = []
    for index, node in enumerate(source.get("nodes", [])):
        if "mesh" not in node:
            continue
        match = pattern.match(node.get("name", ""))
        if not match:
            continue
        sides = int(match.group(1))
        palette = next(palette for palette in PALETTES if palette.lower() == match.group(2).lower())
        selected.append((sides, palette, index))

    expected = {(sides, palette) for sides in SIDES for palette in PALETTES}
    found = {(sides, palette) for sides, palette, _ in selected}
    if found != expected or len(selected) != len(expected):
        missing = sorted(expected - found)
        raise ValueError(f"Expected {len(expected)} unique dice meshes; missing: {missing}")

    destinations = [
        args.output / palette.lower() / f"d{sides}.glb"
        for sides, palette, _ in selected
    ]
    existing = [path for path in destinations if path.exists()]
    if existing and not args.overwrite:
        raise FileExistsError(
            "Output models already exist; pass --overwrite to replace them: "
            + ", ".join(str(path) for path in existing)
        )

    total_bytes = 0
    for sides, palette, node_index in sorted(selected, key=lambda item: (item[1], item[0])):
        destination = args.output / palette.lower() / f"d{sides}.glb"
        destination.parent.mkdir(parents=True, exist_ok=True)
        SingleMeshExporter(source, binary).export(node_index, destination)
        total_bytes += destination.stat().st_size
        print(f"d{sides} {palette}: {destination.stat().st_size:,} bytes")

    print(f"Extracted {len(selected)} models ({total_bytes:,} bytes) to {args.output}")


if __name__ == "__main__":
    main()
