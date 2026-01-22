import io

from fontTools.ttLib import TTFont
from fontTools.cffLib import CharStrings, TopDict
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.misc.psCharStrings import T2CharString


class PyodideTTXProcessor:
    def __init__(self, font_data: bytes, font_number=0):
        font_io = io.BytesIO(font_data)

        # Open font with FontTools
        self.font = TTFont(font_io, fontNumber=font_number)
        self.cmap: dict[int, str] = self.font.getBestCmap()

        # Set bit for Hangul Jamo
        self.font['OS/2'].ulUnicodeRange1 |= 1 << 28

    def get_gsub_table(self) -> str:
        # Create XML output
        output = io.StringIO()

        # Dump to TTX format
        self.font.saveXML(output, tables=['GSUB'])

        return output.getvalue()

    def get_cmap(self) -> dict[int, str]:
        return self.cmap

    def add_gsub_table(self, gsub_ttx: str):
        # Load GSUB table from TTX format
        gsub_io = io.StringIO(gsub_ttx)
        gsub_font = TTFont()
        gsub_font.importXML(gsub_io)

        self.font['GSUB'] = gsub_font['GSUB']

        output = io.BytesIO()
        self.font.save(output)

        return output.getvalue()

    def add_glyphs(self, glyphs: dict[str, list]):
        glyph_order = self.font.getGlyphOrder()
        cff = self.font["CFF "].cff
        top_dict = cff.topDictIndex[0]
        charstrings: CharStrings = top_dict.CharStrings

        results = {}
        for key, path in glyphs.items():
            width, height = 1000, 1000
            pen = T2CharStringPen(width, None)
            for subpath in path:
                for command in subpath:
                    cmd = command[0]
                    args = command[1:]
                    if cmd == "M":
                        pen.moveTo((args[0], args[1]))
                    elif cmd == "L":
                        pen.lineTo((args[0], args[1]))
                    elif cmd == "C":
                        pen.curveTo((args[0], args[1]), (args[2], args[3]), (args[4], args[5]))
                    elif cmd == "Q":
                        pen.qCurveTo((args[0], args[1]), (args[2], args[3]))
                    elif cmd == "Z":
                        pen.closePath()
                    else:
                        raise ValueError(f"Unknown command: {cmd}")
            new_charstring = pen.getCharString(
                top_dict.FDArray[0].Private,
                cff.GlobalSubrs,
            )
            new_glyph_name = register_cff_glyph(
                new_charstring,
                width, height,
                f"jamo_{key}",
                self.font,
                glyph_order,
                top_dict,
                charstrings,
            )
            results[key] = new_glyph_name

        self.font.setGlyphOrder(glyph_order)

        return results

    def close(self):
        self.font.close()


def register_cff_glyph(
        new_charstring: T2CharString,
        width: int,
        height: int,
        new_glyph_name: str,
        font: TTFont,
        glyph_order,
        top_dict: TopDict,
        charstrings: CharStrings,
):
    # Add the new CharString to the CharStrings Index
    charstrings.charStringsIndex.append(new_charstring)
    # Get the new internal index (next available slot)
    new_glyph_index = len(charstrings.charStringsIndex) - 1
    # Update the Charset (Index -> Name/CID)
    # Check if this is a CID-keyed font
    if hasattr(top_dict, 'ROS'):
        # For CID fonts, the charset holds integers (CIDs), not strings.
        new_cid = int(top_dict.charset[-1].replace("cid", "")) + 1
        new_glyph_name = f"cid{new_cid}"
        top_dict.charset.append(new_glyph_name)  # this also appends to the glyph order internally
        # Update FDSelect (Critical for CID fonts)
        # We must assign the new glyph to a Font Dict. We'll reuse the last one used.
        if hasattr(top_dict, 'FDSelect'):
            # FDSelect is usually a list-like object matching glyph indices
            # Copy the FD index from the previous glyph
            last_fd_index = top_dict.FDSelect[new_glyph_index - 1]
            top_dict.FDSelect.append(last_fd_index)
        top_dict.CIDCount = top_dict.CIDCount + 1
    else:
        # For standard fonts (Name-keyed), charset holds strings
        top_dict.charset.append(new_glyph_name)  # this also appends to the glyph order internally

    charstrings.charStrings[new_glyph_name] = new_glyph_index

    # Update horizontal metrics table
    hmtx_table = font['hmtx']
    # Assign a width and left side bearing
    hmtx_table.metrics[new_glyph_name] = (width, 0)

    # Update vertical metrics table if present
    if font.has_key('vmtx'):
        vmtx_table = font['vmtx']
        # Assign a height and top side bearing
        vmtx_table.metrics[new_glyph_name] = (height, 0)

    return new_glyph_name


# if __name__ == "__main__":
#     with open("/home/park/devel/fonts/SunBatang-Light.otf", "rb") as f:
#         font_data = f.read()
#     ttx = PyodideTTXProcessor(font_data)
#     ttx.add_glyphs({
#         'testglyph': [
#             [("M", 100, 100), ("L", 200, 100), ("L", 200, 200), ("L", 100, 200), ("Z",)],
#         ],
#     })
#     ttx.font.save("/home/park/devel/fonts/SunBatang-Light-new.otf")
