from fontTools.ttLib import TTFont
import io


class PyodideTTXProcessor:
    def getGsubTable(self, font_data: bytes, font_number=0) -> str:
        try:
            font_io = io.BytesIO(font_data)

            # Open font with FontTools
            font = TTFont(font_io, fontNumber=font_number)

            # Create XML output
            output = io.StringIO()

            # Dump to TTX format
            font.saveXML(output, tables=['GSUB'])

            font.close()
            return output.getvalue()

        except Exception as e:
            raise Exception(f"Failed to dump to TTX: {e}")


# Create global processor instance
ttx_processor = PyodideTTXProcessor()
