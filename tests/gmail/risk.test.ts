import { describe, it, expect } from "vitest";
import { parseMessage } from "../../src/gmail/headers.js";
import { riskSignals } from "../../src/gmail/risk.js";

function withHeaders(hs: [string,string][]) {
  return parseMessage({ id:"x", threadId:"x", snippet:"", payload:{ headers:
    [["From","a@b.com"] as [string,string], ...hs].map(([name,value]) => ({ name, value })) }});
}

describe("riskSignals", () => {
  it("flags bulk mail with a List-Unsubscribe header", () => {
    const s = riskSignals(withHeaders([["List-Unsubscribe","<mailto:u@b.com>"]]));
    expect(s.bulk).toBe(true);
    expect(s.hasListUnsubscribe).toBe(true);
  });
  it("flags Precedence: bulk", () => {
    expect(riskSignals(withHeaders([["Precedence","bulk"]])).bulk).toBe(true);
  });
  it("flags transactional keywords in the subject", () => {
    const m = parseMessage({ id:"x",threadId:"x",snippet:"",payload:{headers:[
      {name:"From",value:"a@b.com"},{name:"Subject",value:"Your invoice #123 receipt"}]}});
    expect(riskSignals(m).transactional).toBe(true);
  });
  it("treats a plain personal mail as non-bulk, non-transactional", () => {
    const s = riskSignals(withHeaders([["Subject","coffee tomorrow"]]));
    expect(s).toEqual({ bulk:false, hasListUnsubscribe:false, transactional:false });
  });
});
