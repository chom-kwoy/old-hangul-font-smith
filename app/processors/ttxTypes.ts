export type Ttx = {
  ttFont: {
    GSUB: TtxTable[];
  }[];
};

export type TtxTable = Gsub;

export type Gsub = {
  Version: {
    "@_value": "0x00010000";
  }[];
  ScriptList: {
    ScriptRecord: {
      "@_index": string;
      ScriptTag: {
        "@_value": string;
      }[];
      Script: {
        DefaultLangSys: {
          ReqFeatureIndex: {
            "@_value": string;
          }[];
          FeatureIndex: {
            "@_index": string;
            "@_value": string;
          }[];
        }[];
      }[];
    }[];
  }[];
  FeatureList: {
    FeatureRecord: {
      "@_index": string;
      FeatureTag: {
        "@_value": string;
      }[];
      Feature: {
        LookupListIndex: {
          "@_index": string;
          "@_value": string;
        }[];
      }[];
    }[];
  }[];
  LookupList: {
    Lookup: {
      "@_index": string;
      LookupType: {
        "@_value": string;
      }[];
      LookupFlag: {
        "@_value": string;
      }[];
      SingleSubst?: SingleSubst[];
      ChainContextSubst?: ChainContextSubst[];
      LigatureSubst?: LigatureSubst[];
    }[];
  }[];
};

export type SingleSubst = {
  Substitution: {
    "@_in": string;
    "@_out": string;
  }[];
};

export type ChainContextSubst = {
  "@_index": string;
  "@_Format": string;
  BacktrackCoverage: {
    "@_index": string;
    Glyph: {
      "@_value": string;
    }[];
  }[];
  InputCoverage: {
    "@_index": string;
    Glyph: {
      "@_value": string;
    }[];
  }[];
  LookAheadCoverage: {
    "@_index": string;
    Glyph: {
      "@_value": string;
    }[];
  }[];
  SubstLookupRecord: {
    "@_index": string;
    SequenceIndex: {
      "@_value": string;
    }[];
    LookupListIndex: {
      "@_value": string;
    }[];
  }[];
};

export type LigatureSubst = {
  "@_index": string;
  LigatureSet: {
    "@_glyph": string;
    Ligature: {
      "@_components": string;
      "@_glyph": string;
    }[];
  }[];
};
