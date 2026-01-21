from fontTools.ttLib import TTFont
import io


class PyodideTTXProcessor:
    def __init__(self, font_data: bytes, font_number=0):
        font_io = io.BytesIO(font_data)

        # Open font with FontTools
        self.font = TTFont(font_io, fontNumber=font_number)
        self.cmap: dict[int, str] = self.font.getBestCmap()

    def getGsubTable(self) -> str:
        # Create XML output
        output = io.StringIO()

        # Dump to TTX format
        self.font.saveXML(output, tables=['GSUB'])

        return output.getvalue()

    def getCmap(self) -> dict[int, str]:
        return self.cmap

    def addGsubTable(self, gsub_ttx: str):
        # Load GSUB table from TTX format
        gsub_io = io.StringIO(gsub_ttx)
        gsub_font = TTFont()
        gsub_font.importXML(gsub_io)

        self.font['GSUB'] = gsub_font['GSUB']

        output = io.BytesIO()
        self.font.save(output)

        return output.getvalue()

    def close(self):
        self.font.close()
