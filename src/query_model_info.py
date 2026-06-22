import os
import sqlite3
import base64
import json

# Resolve state.vscdb path dynamically for Linux, Windows, and WSL environments
home = os.path.expanduser('~')
db_path = os.path.join(os.environ.get('APPDATA', os.path.join(home, 'AppData', 'Roaming')), "Antigravity IDE", "User", "globalStorage", "state.vscdb")
if not os.path.exists(db_path):
    # Fallback to Linux/WSL style ~/.config path
    db_path = os.path.join(home, ".config", "Antigravity IDE", "User", "globalStorage", "state.vscdb")

def parse_protobuf_varint(data, pos):
    val = 0
    shift = 0
    while True:
        if pos >= len(data):
            break
        byte = data[pos]
        val |= (byte & 0x7f) << shift
        pos += 1
        if not (byte & 0x80):
            break
        shift += 7
    return val, pos

def parse_protobuf_tag_val(data):
    pos = 0
    tags = {}
    while pos < len(data):
        if pos >= len(data):
            break
        key, pos = parse_protobuf_varint(data, pos)
        tag = key >> 3
        wire_type = key & 7
        
        if wire_type == 0:
            val, pos = parse_protobuf_varint(data, pos)
            tags[tag] = val
        elif wire_type == 1:
            if pos + 8 <= len(data):
                import struct
                val_bytes = data[pos:pos+8]
                pos += 8
                val_double = struct.unpack('<d', val_bytes)[0]
                tags[tag] = val_double
            else:
                break
        elif wire_type == 2:
            length, pos = parse_protobuf_varint(data, pos)
            val_bytes = data[pos:pos+length]
            pos += length
            if tag in tags:
                if not isinstance(tags[tag], list):
                    tags[tag] = [tags[tag]]
                tags[tag].append(val_bytes)
            else:
                tags[tag] = val_bytes
        elif wire_type == 5:
            if pos + 4 <= len(data):
                import struct
                val_bytes = data[pos:pos+4]
                pos += 4
                val_float = struct.unpack('<f', val_bytes)[0]
                tags[tag] = val_float
            else:
                break
        else:
            break
    return tags

def get_active_model_id():
    # First try modelPreferences (as it updates immediately on dropdown change)
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.modelPreferences'")
        row = cursor.fetchone()
        conn.close()
        if row:
            outer_decoded = base64.b64decode(row[0])
            outer_tags = parse_protobuf_tag_val(outer_decoded)
            
            sub_msg = outer_tags.get(1)
            if sub_msg:
                sub_tags = parse_protobuf_tag_val(sub_msg)
                inner_sub = sub_tags.get(2)
                if inner_sub:
                    inner_tags = parse_protobuf_tag_val(inner_sub)
                    b64_val = inner_tags.get(1)
                    if b64_val:
                        if isinstance(b64_val, bytes):
                            b64_val = b64_val.decode('utf-8')
                            
                        model_pref_bytes = base64.b64decode(b64_val)
                        pref_tags = parse_protobuf_tag_val(model_pref_bytes)
                        model_id = pref_tags.get(2)
                        if model_id is not None:
                            return model_id
    except Exception:
        pass

    # Fallback to userStatus (which updates on active session/message execution)
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.userStatus'")
        row = cursor.fetchone()
        conn.close()
        if row:
            outer_tags = parse_protobuf_tag_val(base64.b64decode(row[0]))
            first_layer_bytes = outer_tags.get(1)
            if first_layer_bytes:
                first_layer_tags = parse_protobuf_tag_val(first_layer_bytes)
                tag2_bytes = first_layer_tags.get(2)
                if tag2_bytes:
                    tag2_tags = parse_protobuf_tag_val(tag2_bytes)
                    inner_b64 = tag2_tags.get(1)
                    if inner_b64:
                        if isinstance(inner_b64, bytes):
                            inner_b64 = inner_b64.decode('utf-8')
                        inner_tags = parse_protobuf_tag_val(base64.b64decode(inner_b64))
                        models_data = inner_tags.get(33)
                        if models_data:
                            models_data_tags = parse_protobuf_tag_val(models_data)
                            tag3_val = models_data_tags.get(3)
                            if tag3_val and isinstance(tag3_val, bytes):
                                tag3_tags = parse_protobuf_tag_val(tag3_val)
                                sub_val = tag3_tags.get(1)
                                if isinstance(sub_val, bytes):
                                    sub_tags = parse_protobuf_tag_val(sub_val)
                                    active_id = sub_tags.get(1)
                                    if active_id is not None:
                                        return active_id
    except Exception:
        return None


def get_models_info():
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.userStatus'")
        row = cursor.fetchone()
        conn.close()
        if not row:
            return []
            
        outer_decoded = base64.b64decode(row[0])
        outer_tags = parse_protobuf_tag_val(outer_decoded)
        
        first_layer_bytes = outer_tags.get(1)
        if not first_layer_bytes:
            return []
        first_layer_tags = parse_protobuf_tag_val(first_layer_bytes)
        
        tag2_bytes = first_layer_tags.get(2)
        if not tag2_bytes:
            return []
        tag2_tags = parse_protobuf_tag_val(tag2_bytes)
        
        inner_b64 = tag2_tags.get(1)
        if not inner_b64:
            return []
        if isinstance(inner_b64, bytes):
            inner_b64 = inner_b64.decode('utf-8')
            
        inner_decoded = base64.b64decode(inner_b64)
        inner_tags = parse_protobuf_tag_val(inner_decoded)
        
        models_data = inner_tags.get(33)
        if not models_data:
            return []
            
        models = []
        pos = 0
        while pos < len(models_data):
            key, pos = parse_protobuf_varint(models_data, pos)
            tag = key >> 3
            wire_type = key & 7
            if tag == 1 and wire_type == 2:
                length, pos = parse_protobuf_varint(models_data, pos)
                model_bytes = models_data[pos:pos+length]
                pos += length
                
                # Full parse to collect repeated tag18 entries
                model_items = []
                mpos = 0
                while mpos < len(model_bytes):
                    mkey, mpos = parse_protobuf_varint(model_bytes, mpos)
                    mtag = mkey >> 3
                    mwire = mkey & 7
                    if mwire == 0:
                        mval, mpos = parse_protobuf_varint(model_bytes, mpos)
                        model_items.append((mtag, mwire, mval))
                    elif mwire == 1:
                        if mpos + 8 <= len(model_bytes):
                            mpos += 8
                        else:
                            break
                    elif mwire == 2:
                        mlength, mpos = parse_protobuf_varint(model_bytes, mpos)
                        mbytes = model_bytes[mpos:mpos+mlength]
                        mpos += mlength
                        model_items.append((mtag, mwire, mbytes))
                    elif mwire == 5:
                        if mpos + 4 <= len(model_bytes):
                            mpos += 4
                        else:
                            break
                    else:
                        break
                
                # Extract fields from parsed items
                name = "Unknown"
                model_id = None
                quota = None
                expiration = None
                mime_type_count = 0
                
                for mtag, mwire, mval in model_items:
                    if mtag == 1 and mwire == 2:
                        # Model name
                        try:
                            name = mval.decode('utf-8')
                        except:
                            pass
                    elif mtag == 2 and mwire == 2:
                        # ID submessage -> tag1 = model_id
                        id_tags = parse_protobuf_tag_val(mval)
                        model_id = id_tags.get(1)
                    elif mtag == 5 and mwire == 0:
                        # Quota status (1 = available)
                        quota = mval
                    elif mtag == 15 and mwire == 2:
                        # Quota info submessage -> tag2 submsg -> tag1 = expiration timestamp
                        tag15_tags = parse_protobuf_tag_val(mval)
                        remaining_fraction = tag15_tags.get(1)
                        if remaining_fraction is None:
                            remaining_fraction = 0.0
                        tag15_sub2 = tag15_tags.get(2)
                        if tag15_sub2 and isinstance(tag15_sub2, bytes):
                            tag15_sub2_tags = parse_protobuf_tag_val(tag15_sub2)
                            expiration = tag15_sub2_tags.get(1)
                    elif mtag == 18 and mwire == 2:
                        # Supported MIME type entry
                        mime_type_count += 1
                
                models.append({
                    "name": name,
                    "id": model_id,
                    "quota": quota,
                    "expiration": expiration,
                    "remainingFraction": remaining_fraction if 'remaining_fraction' in locals() else 0.0,
                    "mimeTypeCount": mime_type_count
                })
            else:
                if wire_type == 0:
                    _, pos = parse_protobuf_varint(models_data, pos)
                elif wire_type == 1:
                    pos += 8
                elif wire_type == 2:
                    length, pos = parse_protobuf_varint(models_data, pos)
                    pos += length
                elif wire_type == 5:
                    pos += 4
        return models
    except Exception:
        return []

def main():
    active_id = get_active_model_id()
    models = get_models_info()
    
    active_model = None
    if active_id is not None:
        for m in models:
            if m["id"] == active_id:
                active_model = m
                break
                
    output = {
        "activeModel": active_model["name"] if active_model else "Gemini 3.5 Flash (High)",
        "activeModelId": active_id,
        "expiration": active_model["expiration"] if active_model else None,
        "remainingFraction": active_model["remainingFraction"] if active_model else 0.0,
        "models": models
    }
    print(json.dumps(output))

if __name__ == "__main__":
    main()
