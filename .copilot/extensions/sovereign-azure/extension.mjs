// Extension: sovereign-azure
// Sovereign Architect — Azure sovereign workload design expert
//
// Workflow:
//   Validation  — Check if a Sovereign Landing Zone already exists (always first)
//   LZ-first    — No LZ: gather requirements → design LZ → offer workload design
//   Normal      — Has LZ: gather requirements → design → review → rework → OUTPUT → LZ additions
//
// State machine per session:
//   idle
//     └─(sovereignty trigger)─► validating-lz
//             ├─(lz exists)────► gathering ──► designing ──► reviewing ──► reworking ──► outputting ──► landing-zone ──► complete
//             └─(no lz)────────► gathering ──► lz-setup ──► idle (lzExists=true)
//                                                               └─(workload)─► designing ──► reviewing ──► reworking ──► outputting ──► complete
//
// Output (Bicep + HTML) is ALWAYS the last step — written only after rubber-duck review and rework.

import { joinSession } from "@github/copilot-sdk/extension";
import fs   from "fs";
import path from "path";

// Output folder — sovereign-output/<timestamp>-<sessionSuffix>/ per session
const BASE_OUTPUT_DIR = path.join(process.cwd(), "sovereign-output");

function sessionOutputDir(sessionId) {
    const sess = sessions.get(sessionId);
    if (!sess) return BASE_OUTPUT_DIR;
    if (!sess.outputDir) {
        const ts   = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const rand = Math.random().toString(36).slice(2, 5);
        sess.outputDir = path.join(BASE_OUTPUT_DIR, `${ts}-${rand}`);
    }
    return sess.outputDir;
}

function ensureOutputDir(sessionId) {
    fs.mkdirSync(sessionOutputDir(sessionId), { recursive: true });
}

// ── Simple markdown → HTML converter ─────────────────────────

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function inlineFormat(text) {
    text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*(.*?)\*/g,     "<em>$1</em>");
    text = text.replace(/`(.*?)`/g,       "<code>$1</code>");
    return text;
}

function markdownToHtml(md) {
    // Protect fenced code blocks
    const codeBlocks = [];
    md = md.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_m, lang, content) => {
        const idx = codeBlocks.push(
            `<pre><code class="lang-${lang}">${escapeHtml(content.trimEnd())}</code></pre>`
        ) - 1;
        return `\x00BLOCK${idx}\x00`;
    });

    const lines  = md.split("\n");
    const output = [];
    let inList   = false;
    let tableRows = [];

    function flushList() {
        if (inList) { output.push("</ul>"); inList = false; }
    }
    function flushTable() {
        if (!tableRows.length) return;
        // First row = header, second row = separator (skip), rest = body
        const [headerRow, , ...bodyRows] = tableRows;
        const thCells = headerRow.map(c => `<th>${inlineFormat(c)}</th>`).join("");
        const tbodyHtml = bodyRows.map(
            row => "<tr>" + row.map(c => `<td>${inlineFormat(c)}</td>`).join("") + "</tr>"
        ).join("\n");
        output.push(`<table>\n<thead><tr>${thCells}</tr></thead>\n<tbody>\n${tbodyHtml}\n</tbody></table>`);
        tableRows = [];
    }

    function parseCells(line) {
        return line.split("|").slice(1, -1).map(c => c.trim());
    }
    function isSeparator(cells) {
        return cells.every(c => /^[-:]+$/.test(c));
    }

    for (const line of lines) {
        if (line.startsWith("|")) {
            flushList();
            const cells = parseCells(line);
            if (!isSeparator(cells)) tableRows.push(cells);
            continue;
        }

        flushTable();

        if (/^### /.test(line))      { flushList(); output.push(`<h3>${inlineFormat(line.slice(4))}</h3>`); }
        else if (/^## /.test(line))  { flushList(); output.push(`<h2>${inlineFormat(line.slice(3))}</h2>`); }
        else if (/^# /.test(line))   { flushList(); output.push(`<h1>${inlineFormat(line.slice(2))}</h1>`); }
        else if (/^[-*] /.test(line)) {
            if (!inList) { output.push("<ul>"); inList = true; }
            output.push(`<li>${inlineFormat(line.slice(2))}</li>`);
        }
        else if (line.trim() === "") { flushList(); output.push(""); }
        else {
            const f = inlineFormat(line);
            if (f.startsWith("\x00BLOCK")) output.push(f);
            else if (f.trim()) output.push(`<p>${f}</p>`);
        }
    }

    flushList();
    flushTable();

    return output.join("\n")
        .replace(/\x00BLOCK(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);
}

// ── HTML page wrapper ─────────────────────────────────────────

function buildHtmlPage(title, subtitle, bodyHtml) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --blue:   #0f3460;
    --mid:    #16213e;
    --accent: #0078d4;
    --light:  #e8f0fe;
    --text:   #1a1a2e;
    --border: #c8d6e5;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body   { font-family: "Segoe UI", system-ui, sans-serif; background: #f4f7fb; color: var(--text); margin: 0; padding: 0; }
  header { background: linear-gradient(135deg, var(--mid), var(--blue)); color: #fff; padding: 2rem 3rem; }
  header h1 { margin: 0 0 .4rem; font-size: 1.8rem; }
  header p  { margin: 0; opacity: .8; font-size: .95rem; }
  main   { max-width: 1000px; margin: 2rem auto; padding: 0 2rem 4rem; }
  h1     { color: var(--blue); border-bottom: 3px solid var(--accent); padding-bottom: .4rem; margin-top: 2rem; }
  h2     { color: var(--blue); margin-top: 2rem; }
  h3     { color: var(--accent); margin-top: 1.5rem; }
  table  { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .9rem; }
  th     { background: var(--blue); color: #fff; padding: .55rem .9rem; text-align: left; }
  td     { padding: .5rem .9rem; border-bottom: 1px solid var(--border); }
  tr:nth-child(even) td { background: var(--light); }
  code   { background: #e8ecf2; border-radius: 3px; padding: .15em .4em; font-size: .88em; }
  pre    { background: #1e2a3a; color: #d4e0ef; border-radius: 6px; padding: 1.2rem; overflow-x: auto; font-size: .85rem; }
  pre code { background: none; color: inherit; padding: 0; }
  ul     { padding-left: 1.4rem; }
  li     { margin: .3rem 0; }
  p      { line-height: 1.65; }
  strong { color: var(--blue); }
  .badge { display: inline-block; background: var(--accent); color: #fff; border-radius: 4px; padding: .2em .6em; font-size: .8rem; margin: .15rem .1rem; }
  .warn  { background: #fff3cd; border-left: 4px solid #ffc107; padding: .75rem 1rem; border-radius: 4px; margin: 1rem 0; font-size: .9rem; }
  footer { text-align: center; padding: 1.5rem; font-size: .8rem; color: #888; border-top: 1px solid var(--border); margin-top: 3rem; }
</style>
</head>
<body>
<header>
  <h1>🏛️ ${escapeHtml(title)}</h1>
  <p>${escapeHtml(subtitle)}</p>
</header>
<main>
${bodyHtml}
</main>
<footer>Generated by Sovereign Architect · ${new Date().toISOString().slice(0,10)}</footer>
</body>
</html>`;
}

function writeHtml(slug, title, subtitle, markdown, sessionId) {
    ensureOutputDir(sessionId);
    const html     = markdownToHtml(markdown);
    const page     = buildHtmlPage(title, subtitle, html);
    const filename = `${slug}.html`;
    const filepath = path.join(sessionOutputDir(sessionId), filename);
    fs.writeFileSync(filepath, page, "utf8");
    return filepath;
}

function writeBicep(filename, content, sessionId) {
    ensureOutputDir(sessionId);
    // Take basename first to strip any path traversal, then sanitise characters
    const base = path.basename(filename);
    const safe = base.replace(/[^a-zA-Z0-9._-]/g, "-");
    const filepath = path.join(sessionOutputDir(sessionId), safe);
    fs.writeFileSync(filepath, content, "utf8");
    return filepath;
}

const sessions = new Map();

function getSessionState(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            state: "idle",
            lzExists: false,   // true once a Sovereign LZ is confirmed or defined
            lzFirst:  false,   // true when taking the LZ-first path (no LZ existed)
            profile: null,
            architecture: null,    // draft architecture (pre-review)
            reviewNotes: null,     // rubber-duck critique findings
            landingZone: null,
        });
    }
    return sessions.get(sessionId);
}

function summarizeProfile(profile) {
    const lines = ["### Customer Sovereignty Profile"];
    const { data, control_plane, software, completeness, notes } = profile;

    if (data) {
        lines.push("\n**Data Sovereignty:**");
        if (data.residency_regions?.length)   lines.push(`- Residency: ${data.residency_regions.join(", ")}`);
        if (data.regulations?.length)          lines.push(`- Regulations: ${data.regulations.join(", ")}`);
        if (data.data_types?.length)           lines.push(`- Data types: ${data.data_types.join(", ")}`);
        if (data.cross_border_allowed != null) lines.push(`- Cross-border transfer: ${data.cross_border_allowed ? "allowed" : "NOT allowed"}`);
        if (data.access_restrictions)          lines.push(`- Access restrictions: ${data.access_restrictions}`);
    }

    if (control_plane) {
        lines.push("\n**Control Plane Sovereignty:**");
        if (control_plane.environment)               lines.push(`- Target environment: ${control_plane.environment}`);
        if (control_plane.operator_restrictions)     lines.push(`- Operator restrictions: ${control_plane.operator_restrictions}`);
        if (control_plane.lockbox_required != null)  lines.push(`- Customer Lockbox: ${control_plane.lockbox_required ? "required" : "not required"}`);
        if (control_plane.key_management)            lines.push(`- Key management: ${control_plane.key_management}`);
        if (control_plane.disconnected_ops)          lines.push(`- Disconnected/air-gapped: required`);
        if (control_plane.support_access_restrictions) lines.push(`- Support access: ${control_plane.support_access_restrictions}`);
        if (control_plane.audit_jurisdiction)        lines.push(`- Audit jurisdiction: ${control_plane.audit_jurisdiction}`);
    }

    if (software) {
        lines.push("\n**Software Sovereignty:**");
        if (software.vendor_independence)    lines.push(`- Vendor independence: ${software.vendor_independence}`);
        if (software.oss_preference)         lines.push(`- Open-source preference: yes`);
        if (software.portability_required)   lines.push(`- Cloud portability: required`);
        if (software.hybrid_required)        lines.push(`- Hybrid/on-premises: required`);
        if (software.software_restrictions)  lines.push(`- Software restrictions: ${software.software_restrictions}`);
    }

    if (notes)        lines.push(`\n**Notes:** ${notes}`);
    if (completeness) lines.push(`\n*Completeness: ${completeness}*`);

    return lines.join("\n");
}

const BASE_CONTEXT = `
## Sovereign Architect — Expert Context

You are the Sovereign Architect, an expert in Microsoft Cloud for Sovereignty and Azure sovereign workload design.
Sovereignty is NOT a fixed concept — it means different things to each customer. Always gather requirements before designing.

### Three Sovereignty Pillars (customer-specific)
1. **Data Sovereignty** — Where data must reside; who may access it; which regulations apply (GDPR, NIS2, FedRAMP, ITAR, EUCS, etc.).
2. **Control Plane Sovereignty** — Who controls the management plane; operator nationality/clearance restrictions; key management (CMK/Managed HSM); Customer Lockbox; audit jurisdiction; support access gates.
3. **Software Sovereignty** — Vendor independence; open standards; workload portability; on-premises/hybrid requirements; SBOM and provenance.

### Azure Sovereign Environments
- **Commercial Azure + Microsoft Cloud for Sovereignty**: Sovereign controls (SLZ, CMK, Lockbox) on top of global Azure. Best for EU/national government regulated workloads.
- **Azure Government** (US): FedRAMP High, DoD IL2–IL5, ITAR, CJIS. Dedicated US-soil infrastructure.
- **Azure China** (21Vianet): Operated under Chinese regulation by a local entity.
- **Sovereign/Dedicated Regions**: Single-country infrastructure for select national government customers.
- **Air-gapped / Disconnected**: Fully isolated from public internet; operated by customer or trusted integrator.

### Key Technologies
- **Sovereign Landing Zone (SLZ)**: Policy-driven baseline; policy portfolio for GDPR, NIS2, EUCS, FedRAMP.
- **Confidential Computing**: Hardware TEEs (AMD SEV-SNP, Intel TDX) — protect data-in-use.
- **Customer-Managed Keys / Managed HSM**: BYOK with FIPS 140-2 Level 3 HSMs.
- **Customer Lockbox**: Explicit customer approval gate for any Microsoft support access.
- **Private Endpoints / Azure Private Link**: Eliminate public internet exposure for all PaaS.
- **Microsoft Entra ID + PIM**: Identity governance; just-in-time privileged access; nationality controls.
- **Azure Arc**: Extend sovereign governance to on-premises, edge, and multi-cloud.
- **Defender for Cloud**: Continuous compliance monitoring and regulatory assessment dashboards.

### Two-Step Design Workflow
Step 0 — Gather the customer's sovereignty profile (data / control plane / software).
Step 1 — Design a complete end-to-end sovereign architecture aligned to the profile.
Step 2 — Design the Landing Zone, governance structure, and policy surroundings to operate that architecture.
Always complete Step 0 before Step 1, and Step 1 before Step 2.
`;

async function searchLearn(query, top = 5) {
    const url = `https://learn.microsoft.com/api/search?search=${encodeURIComponent(query)}&locale=en-us&$top=${Math.min(top, 10)}`;
    const res = await fetch(url, { headers: { "User-Agent": "SovereignArchitect/1.0" } });
    if (!res.ok) return `Error: HTTP ${res.status}`;
    const data = await res.json();
    return data.results?.map(r => `**${r.title}**\n${r.description || ""}\n${r.url}\n`).join("\n---\n") || "No results found.";
}

const session = await joinSession({
    tools: [
        {
            name: "sovereign_architect_gather_requirements",
            description: `Capture the customer's specific sovereignty requirements across three pillars: Data Sovereignty, Control Plane Sovereignty, and Software Sovereignty.

WHEN TO USE: Before designing any sovereign Azure architecture. First ask the user the questions below in conversation, then call this tool with their answers.

QUESTIONS TO ASK THE CUSTOMER:

DATA SOVEREIGNTY:
1. Where must your data reside? (countries, regions, or jurisdictions — e.g., Netherlands, EU-only, Germany)
2. Which regulations or standards apply? (e.g., GDPR, NIS2, FedRAMP High, ITAR, CJIS, EUCS, ISO27001)
3. What types of sensitive data are involved? (e.g., PII, financial, health/PHI, government classified, IP)
4. Can data cross national borders for disaster recovery or backup?
5. Who is permitted to access the data? (e.g., EU nationals only, cleared US personnel, customer staff only)

CONTROL PLANE SOVEREIGNTY:
6. Which cloud environment is required? (commercial Azure, Azure Government, sovereign/dedicated region, air-gapped)
7. Are there nationality or security clearance restrictions on operators and support personnel?
8. Is Customer Lockbox required for all Microsoft support access to your environment?
9. How should encryption keys be managed? (Microsoft-managed / customer-managed Key Vault / Managed HSM / on-premises HSM)
10. Is disconnected or air-gapped operation required?
11. What are the audit, incident response, and legal jurisdiction requirements?

SOFTWARE SOVEREIGNTY:
12. How important is vendor independence? (not important / preferred / required)
13. Is there a preference for open-source or open-standard technologies?
14. Must workloads be portable across multiple cloud providers?
15. Is on-premises or hybrid deployment required?
16. Are there restrictions on software origin (e.g., no US-origin software), licensing, or SBOM requirements?`,
            skipPermission: true,
            parameters: {
                type: "object",
                properties: {
                    data: {
                        type: "object",
                        description: "Data sovereignty requirements",
                        properties: {
                            residency_regions:    { type: "array",   items: { type: "string" }, description: "Countries/regions where data must reside (e.g., ['Netherlands', 'EU', 'Germany'])" },
                            regulations:          { type: "array",   items: { type: "string" }, description: "Applicable regulations (e.g., ['GDPR', 'NIS2', 'FedRAMP High'])" },
                            data_types:           { type: "array",   items: { type: "string" }, description: "Sensitive data types (e.g., ['PII', 'Financial', 'Health/PHI', 'Classified'])" },
                            cross_border_allowed: { type: "boolean", description: "Whether data may cross national borders for DR/backup" },
                            access_restrictions:  { type: "string",  description: "Who is permitted to access data (e.g., 'EU nationals only', 'US cleared personnel only')" },
                        },
                        required: ["residency_regions", "regulations"],
                    },
                    control_plane: {
                        type: "object",
                        description: "Control plane sovereignty requirements",
                        properties: {
                            environment:                  { type: "string", enum: ["commercial-azure", "azure-government", "azure-china", "sovereign-dedicated-region", "air-gapped"], description: "Target cloud environment" },
                            operator_restrictions:        { type: "string",  description: "Operator/support nationality or clearance restrictions" },
                            lockbox_required:             { type: "boolean", description: "Whether Customer Lockbox is required" },
                            key_management:               { type: "string",  enum: ["microsoft-managed", "customer-managed-vault", "managed-hsm", "on-premises-hsm"], description: "Encryption key management approach" },
                            disconnected_ops:             { type: "boolean", description: "Whether disconnected/air-gapped operations are required" },
                            support_access_restrictions:  { type: "string",  description: "Restrictions on Microsoft/vendor support access" },
                            audit_jurisdiction:           { type: "string",  description: "Jurisdiction for audits, incident response, and legal process" },
                        },
                        required: ["environment"],
                    },
                    software: {
                        type: "object",
                        description: "Software sovereignty requirements",
                        properties: {
                            vendor_independence:    { type: "string",  enum: ["not-required", "preferred", "required"], description: "Required level of vendor independence" },
                            oss_preference:         { type: "boolean", description: "Preference for open-source or open-standard technologies" },
                            portability_required:   { type: "boolean", description: "Whether workload portability across cloud providers is required" },
                            hybrid_required:        { type: "boolean", description: "Whether on-premises or hybrid deployment is required" },
                            software_restrictions:  { type: "string",  description: "Restrictions on software origin, licensing, or SBOM requirements" },
                        },
                        required: ["vendor_independence"],
                    },
                    completeness: { type: "string", enum: ["partial", "complete"], description: "Whether all known requirements have been captured" },
                    notes:        { type: "string",  description: "Additional context, constraints, or customer-specific notes" },
                },
                required: ["data", "control_plane", "software", "completeness"],
            },
            handler: async (args, invocation) => {
                const sess = getSessionState(invocation.sessionId);
                sess.profile = args;
                const summary = summarizeProfile(args);
                if (sess.lzFirst) {
                    // LZ-first path: design the Landing Zone next
                    sess.state = "lz-setup";
                    return `Sovereignty profile saved. Proceeding to Sovereign Landing Zone definition.\n\n${summary}`;
                } else {
                    // Normal path: design workload architecture next
                    sess.state = "designing";
                    return `Sovereignty profile saved. Proceeding to Step 1: Sovereign Architecture Design.\n\n${summary}`;
                }
            },
        },
        {
            name: "sovereign_architect_get_profile",
            description: "Retrieve the customer sovereignty profile gathered in this session. Returns a summary and structured JSON of requirements across data, control plane, and software sovereignty pillars.",
            skipPermission: true,
            parameters: { type: "object", properties: {} },
            handler: async (args, invocation) => {
                const sess = getSessionState(invocation.sessionId);
                if (!sess.profile) return "No sovereignty profile has been gathered yet. Use sovereign_architect_gather_requirements to capture customer requirements first.";
                return `${summarizeProfile(sess.profile)}\n\n\`\`\`json\n${JSON.stringify(sess.profile, null, 2)}\n\`\`\``;
            },
        },
        {
            name: "sovereign_architect_confirm_environment",
            description: `Record whether the customer already has a Sovereign Landing Zone in place, and their decision on how to proceed.

WHEN TO USE: After asking the customer the validation question:
  "Do you already have a Sovereign Landing Zone and Management Group hierarchy in place? (y/n)"

Then based on their answer, ask one follow-up:
  - If YES → "Would you like to continue designing a sovereign workload on top of it?"
  - If NO  → "Would you like to start by defining a new Sovereign Landing Zone?"

Call this tool with their combined answer to advance the workflow.`,
            skipPermission: true,
            parameters: {
                type: "object",
                properties: {
                    lz_exists: { type: "boolean", description: "Whether the customer already has a Sovereign Landing Zone and Management Group hierarchy in place" },
                    proceed:   { type: "boolean", description: "Whether the customer wants to proceed (true = yes to the follow-up question)" },
                },
                required: ["lz_exists", "proceed"],
            },
            handler: async (args, invocation) => {
                const sess = getSessionState(invocation.sessionId);

                if (!args.proceed) {
                    sess.state = "idle";
                    return "Understood. Let me know when you're ready to proceed.";
                }

                // Always reset profile/architecture for a fresh design session
                sess.profile      = null;
                sess.architecture = null;
                sess.reviewNotes  = null;
                sess.landingZone  = null;

                // Eagerly create the output workfolder for this session
                ensureOutputDir(invocation.sessionId);

                if (args.lz_exists) {
                    // Has LZ — gather fresh requirements then design workload
                    sess.lzExists = true;
                    sess.lzFirst  = false;
                    sess.state = "gathering";
                    return "Sovereign Landing Zone confirmed. Now gathering fresh sovereignty requirements before designing the workload architecture.";
                } else {
                    // No LZ — gather requirements then design LZ first
                    sess.lzExists = false;
                    sess.lzFirst  = true;
                    sess.state = "gathering";
                    return "Starting with Sovereign Landing Zone definition. First, let's gather the sovereignty requirements that will shape the landing zone design.";
                }
            },
        },
        {
            name: "sovereign_architect_save_architecture",
            description: `Save the sovereign architecture DRAFT (Step 1) and advance to the rubber-duck review phase.

Call this tool after presenting the initial architecture design to the customer.
This saves the draft only — NO output artifacts are written yet.
Rubber-duck review → rework → output happen in subsequent steps.

The architecture document should cover:
- Architecture overview and sovereignty-driven design principles
- Component design: compute, data, networking, identity — each mapped to sovereignty controls
- Recommended Azure services per tier with sovereign notes
- Sovereignty controls matrix (how each component satisfies data / control plane / software sovereignty)
- Key design decisions driven by the customer's specific profile`,
            skipPermission: true,
            parameters: {
                type: "object",
                properties: {
                    summary:      { type: "string", description: "2–3 sentence summary of the architecture" },
                    architecture: { type: "string", description: "Full architecture design in markdown format" },
                },
                required: ["summary", "architecture"],
            },
            handler: async (args, invocation) => {
                const sess = getSessionState(invocation.sessionId);
                sess.architecture = args;
                // Transition to review — output artifacts written only after rework
                sess.state = "reviewing";
                return `Architecture draft saved.\n\nProceeding to rubber-duck review phase.\n\nCritique this architecture design thoroughly for sovereignty gaps, missing controls, compliance risks, and improvements before rework and final output.`;
            },
        },
        {
            name: "sovereign_architect_save_review",
            description: `Save the rubber-duck critique findings and advance to the rework phase.

Call this tool after performing a thorough rubber-duck critique of the architecture draft.
The review should identify: sovereignty gaps, missing controls, compliance risks, design improvements, and edge cases.`,
            skipPermission: true,
            parameters: {
                type: "object",
                properties: {
                    findings: { type: "string", description: "Rubber-duck critique findings in markdown — gaps, risks, improvements, items to address" },
                },
                required: ["findings"],
            },
            handler: async (args, invocation) => {
                const sess = getSessionState(invocation.sessionId);
                sess.reviewNotes = args.findings;
                sess.state = "reworking";
                return `Review findings saved. Proceeding to rework phase.\n\nIncorporate all critique findings into an improved final architecture, then call sovereign_architect_finalize_architecture to write all output artifacts.`;
            },
        },
        {
            name: "sovereign_architect_finalize_architecture",
            description: `Save the final reworked sovereign architecture and write all output artifacts (HTML presentation + Bicep template).

THIS IS THE OUTPUT STEP — call ONLY after rubber-duck review and rework are complete.
Do NOT call this tool during initial design — it must follow sovereign_architect_save_review.

Writes to the session output folder:
  - architecture.html  — full HTML presentation of the final architecture
  - <filename>.bicep   — complete Bicep IaC template

After this tool completes, the workflow proceeds to Landing Zone & Governance design (Step 2).`,
            skipPermission: true,
            parameters: {
                type: "object",
                properties: {
                    summary:        { type: "string", description: "2–3 sentence summary of the final architecture" },
                    architecture:   { type: "string", description: "Full final architecture in markdown format (incorporating review feedback)" },
                    bicep_filename: { type: "string", description: "Bicep filename, e.g. sovereign-vm-gdpr.bicep" },
                    bicep_content:  { type: "string", description: "Full Bicep template content" },
                },
                required: ["summary", "architecture", "bicep_filename", "bicep_content"],
            },
            handler: async (args, invocation) => {
                const sess = getSessionState(invocation.sessionId);
                sess.architecture = { summary: args.summary, architecture: args.architecture };

                const profile  = sess.profile;
                const subtitle = profile?.data?.regulations?.join(" · ") || "Sovereign Architecture";

                let htmlPath, bicepPath;
                try {
                    htmlPath = writeHtml("architecture", "Sovereign Architecture Design", subtitle, args.architecture, invocation.sessionId);
                } catch (e) {
                    htmlPath = `(could not write HTML: ${e.message})`;
                }
                try {
                    bicepPath = writeBicep(args.bicep_filename, args.bicep_content, invocation.sessionId);
                } catch (e) {
                    bicepPath = `(could not write Bicep: ${e.message})`;
                }

                const outDir = sessionOutputDir(invocation.sessionId);
                if (sess.lzExists) {
                    sess.state = "complete";
                    return `✅ Final architecture saved — all output artifacts written.\n\n✅ Sovereignty profile captured\n✅ Architecture designed, reviewed, and reworked\n✅ Existing Sovereign Landing Zone & Management Group hierarchy governs this workload\n\n📄 Architecture: ${htmlPath}\n📄 Bicep: ${bicepPath}\n📁 Output folder: ${outDir}\n\nNo new Landing Zone design required — existing SLZ policies apply.`;
                }

                sess.state = "landing-zone";
                return `✅ Final architecture saved — all output artifacts written.\n\n📄 Architecture: ${htmlPath}\n📄 Bicep: ${bicepPath}\n📁 Output folder: ${outDir}\n\nProceeding to Step 2: Landing Zone & Governance Design.`;
            },
        },
        {
            name: "sovereign_architect_save_landing_zone",
            description: `Save the completed Landing Zone and Governance design (Step 2) and mark the workflow complete.

Call this tool after presenting the full landing zone and governance structure to the customer.

The landing zone document should cover:
- Management Groups hierarchy aligned to sovereignty and separation of concerns
- Subscription design: environment topology, network separation, resource organization
- Sovereign Landing Zone policy portfolio applied (GDPR, NIS2, EUCS, FedRAMP, etc.)
- Azure Policy assignments: specific built-in and custom policies per regulation, deny effects
- Identity & access governance: Entra ID structure, PIM roles, RBAC, conditional access
- Network topology: hub-spoke design, firewall rules, private endpoints, no-public-access policies
- Monitoring & compliance: Log Analytics workspace, Defender for Cloud standards, compliance dashboards`,
            skipPermission: true,
            parameters: {
                type: "object",
                properties: {
                    summary:      { type: "string", description: "2–3 sentence summary of the landing zone and governance setup" },
                    landing_zone: { type: "string", description: "Full Landing Zone and Governance design in markdown format" },
                },
                required: ["summary", "landing_zone"],
            },
            handler: async (args, invocation) => {
                const sess = getSessionState(invocation.sessionId);
                sess.landingZone = args;
                sess.lzExists = true;

                const profile  = sess.profile;
                const subtitle = profile?.data?.regulations?.join(" · ") || "Sovereign Landing Zone";
                let htmlPath;
                try {
                    htmlPath = writeHtml("landing-zone", "Sovereign Landing Zone & Governance", subtitle, args.landing_zone, invocation.sessionId);
                } catch (e) {
                    htmlPath = `(could not write file: ${e.message})`;
                }

                const outDir = sessionOutputDir(invocation.sessionId);
                if (sess.lzFirst) {
                    sess.lzFirst = false;
                    sess.state = "idle";
                    return `Sovereign Landing Zone & Governance saved.\n\n✅ Sovereign Landing Zone defined.\n📄 HTML presentation: ${htmlPath}\n\nWould you like to continue and design a sovereign workload on top of this landing zone?`;
                } else {
                    sess.state = "complete";
                    return `Landing Zone & Governance saved. Sovereign Architect workflow complete.\n\n✅ Sovereignty profile captured\n✅ Sovereign architecture designed\n✅ Landing Zone & Governance defined\n📄 HTML presentation: ${htmlPath}\n📁 Bicep templates: ${outDir}\n\nAsk for revisions, deep-dives into specific components, or use sovereign_architect_get_profile to review the requirements.`;
                }
            },
        },
        {
            name: "sovereign_architect_write_bicep",
            description: `Write a supplementary Bicep (or ARM JSON) template to the sovereign-output/ folder.

NOTE: The primary Bicep output is written automatically by sovereign_architect_finalize_architecture.
Use this tool ONLY for additional/supplementary templates (e.g., a separate landing zone Bicep, a policy definition file).

The filename should be descriptive and reflect the component, e.g.:
  landing-zone-nlgov.bicep
  policy-gdpr-custom.bicep`,
            skipPermission: true,
            parameters: {
                type: "object",
                properties: {
                    filename: { type: "string", description: "Bicep filename, e.g. webapp-postgres.bicep" },
                    content:  { type: "string", description: "Full Bicep template content" },
                },
                required: ["filename", "content"],
            },
            handler: async (args, invocation) => {
                try {
                    const filepath = writeBicep(args.filename, args.content, invocation.sessionId);
                    return `✅ Bicep template written to: ${filepath}`;
                } catch (e) {
                    return `❌ Failed to write Bicep: ${e.message}`;
                }
            },
        },
        {
            name: "sovereign_architect_search_docs",
            description: "Search Microsoft Learn for up-to-date Azure sovereignty documentation, compliance guides, and reference architectures. USE FOR: Microsoft Cloud for Sovereignty, Azure Government, Sovereign Landing Zone, confidential computing, data residency, GDPR/NIS2/FedRAMP guidance.",
            skipPermission: true,
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string",  description: "Search query (e.g., 'Sovereign Landing Zone policy portfolio', 'Azure confidential computing TEE', 'data residency GDPR Azure')" },
                    top:   { type: "integer", description: "Number of results (1–10, default 5)" },
                },
                required: ["query"],
            },
            handler: async (args) => {
                try {
                    return await searchLearn(args.query, args.top || 5);
                } catch (e) {
                    return `Error fetching docs: ${e.message}`;
                }
            },
        },
        {
            name: "sovereign_architect_cloud_services",
            description: "Get documentation about Azure service availability and compliance capabilities in a specific sovereign cloud environment (Azure Government, Azure China, or Microsoft Cloud for Sovereignty). Optionally filter by a specific Azure service.",
            skipPermission: true,
            parameters: {
                type: "object",
                properties: {
                    cloud: {
                        type: "string",
                        enum: ["azure-government", "azure-china", "microsoft-cloud-for-sovereignty"],
                        description: "The target sovereign cloud environment",
                    },
                    service: { type: "string", description: "Optional: specific Azure service to check (e.g., 'Azure Kubernetes Service', 'Azure SQL Database', 'Azure OpenAI')" },
                },
                required: ["cloud"],
            },
            handler: async (args) => {
                const cloudNames = {
                    "azure-government":               "Azure Government",
                    "azure-china":                    "Azure China 21Vianet",
                    "microsoft-cloud-for-sovereignty": "Microsoft Cloud for Sovereignty",
                };
                const cloudName = cloudNames[args.cloud];
                const query = args.service
                    ? `${args.service} ${cloudName} availability compliance`
                    : `${cloudName} available services capabilities compliance`;
                try {
                    const results = await searchLearn(query, 6);
                    return `### ${cloudName}${args.service ? ` — ${args.service}` : ""}\n\n${results}`;
                } catch (e) {
                    return `Error: ${e.message}`;
                }
            },
        },
        {
            name: "sovereign_architect_landing_zone",
            description: "Get detailed guidance on a specific aspect of the Microsoft Sovereign Landing Zone (SLZ) reference implementation. Topics: architecture overview, policy portfolio, confidential computing, key management, network design, identity, governance.",
            skipPermission: true,
            parameters: {
                type: "object",
                properties: {
                    topic: {
                        type: "string",
                        enum: ["overview", "policy-portfolio", "confidential-computing", "key-management", "network", "identity", "governance"],
                        description: "The SLZ topic to retrieve guidance for",
                    },
                },
                required: ["topic"],
            },
            handler: async (args) => {
                const queries = {
                    "overview":               "Microsoft Sovereign Landing Zone overview architecture deployment",
                    "policy-portfolio":       "Sovereign Landing Zone policy portfolio Azure Policy compliance controls",
                    "confidential-computing": "Azure Confidential Computing sovereign workloads TEE confidential VMs",
                    "key-management":         "Azure Key Vault Managed HSM customer managed keys BYOK sovereignty",
                    "network":                "sovereign network architecture private endpoints Azure firewall hub-spoke",
                    "identity":               "sovereign identity Microsoft Entra ID governance Privileged Identity Management",
                    "governance":             "Microsoft Cloud for Sovereignty governance compliance GDPR NIS2 EUCS regulatory",
                };
                try {
                    const results = await searchLearn(queries[args.topic], 6);
                    return `### Sovereign Landing Zone — ${args.topic}\n\n${results}`;
                } catch (e) {
                    return `Error: ${e.message}`;
                }
            },
        },
    ],
    hooks: {
        onSessionStart: async (input, invocation) => {
            getSessionState(invocation.sessionId); // initialize session
            return { additionalContext: BASE_CONTEXT };
        },
        onUserPromptSubmitted: async (input, invocation) => {
            const sess = getSessionState(invocation.sessionId);
            const isSovereignTopic = /sovereign|compliance|gdpr|data[\s-]?residency|government[\s-]?cloud|azure[\s-]?gov|confidential|regulated|nis2|fedramp|data[\s-]?protection|lockbox|cmk|byok|landing[\s-]?zone|slz|eucs|cloud\s+architect/i.test(input.prompt);
            const isDesignIntent   = /design|architect|build|deploy|implement|create|recommend|plan|set\s+up|help\s+me|proceed/i.test(input.prompt);

            switch (sess.state) {

                case "validating-lz":
                    // Agent is waiting for the y/n answer — guide it to interpret and call the confirm tool
                    return { additionalContext: `The user is answering the landing zone validation question. Interpret their response:
- If they indicate YES (they have an existing Sovereign Landing Zone / Management Group hierarchy):
  Ask: "Would you like to continue designing a sovereign workload on top of it?"
  Then call sovereign_architect_confirm_environment with lz_exists=true and proceed=<their answer>.
- If they indicate NO (no existing Sovereign Landing Zone):
  Ask: "Would you like to start by defining a new Sovereign Landing Zone?"
  Then call sovereign_architect_confirm_environment with lz_exists=false and proceed=<their answer>.` };

                case "gathering":
                    // Mid-intake — provide exact ask_user templates with correct multiselect format
                    return { additionalContext: `Collect the customer's sovereignty requirements across 3 pillars using ask_user. Make 3 separate calls — one per pillar.

⚠️ CRITICAL FORMAT RULE — For multi-select fields (regulations, data types) you MUST use the anyOf format:
  "fieldName": { "type": "array", "title": "...", "items": { "anyOf": [{"const":"GDPR","title":"GDPR"}, ...] }, "default": ["GDPR"], "minItems": 1 }
  DO NOT use: "items": {"type":"string","enum":[...]} — that format fails validation.

STEP 1 — ask_user for Data Sovereignty:
{
  "message": "Sovereign Architect — Data Sovereignty\\n\\nWhere does your data reside, what regulations apply, and what types of sensitive data are involved?",
  "requestedSchema": {
    "properties": {
      "residency":            { "type": "string",  "title": "Where must your data reside?", "description": "e.g. Netherlands, EU-only, Germany, US" },
      "regulations":          { "type": "array",   "title": "Which regulations or standards apply?", "items": { "anyOf": [{"const":"GDPR","title":"GDPR"},{"const":"NIS2","title":"NIS2"},{"const":"FedRAMP High","title":"FedRAMP High"},{"const":"ITAR","title":"ITAR"},{"const":"CJIS","title":"CJIS"},{"const":"EUCS","title":"EUCS"},{"const":"ISO 27001","title":"ISO 27001"},{"const":"HIPAA","title":"HIPAA"}] }, "default": ["GDPR"], "minItems": 1 },
      "data_types":           { "type": "array",   "title": "What types of sensitive data are involved?", "items": { "anyOf": [{"const":"PII","title":"PII (personal data)"},{"const":"Financial","title":"Financial"},{"const":"Health/PHI","title":"Health / PHI"},{"const":"Government classified","title":"Government classified"},{"const":"Intellectual property","title":"Intellectual property"},{"const":"General business","title":"General business"}] }, "default": ["PII"], "minItems": 1 },
      "cross_border":         { "type": "string",  "title": "Can data cross national borders for DR/backup?", "enum": ["Yes", "No"], "default": "No" },
      "access_restrictions":  { "type": "string",  "title": "Who is permitted to access the data? (leave blank if no restriction)", "description": "e.g. EU nationals only, cleared US personnel" }
    },
    "required": ["residency", "regulations", "data_types", "cross_border"]
  }
}

STEP 2 — ask_user for Control Plane Sovereignty:
{
  "message": "Sovereign Architect — Control Plane Sovereignty\\n\\nHow should the cloud environment and key management be configured?",
  "requestedSchema": {
    "properties": {
      "environment":            { "type": "string", "title": "Which cloud environment is required?", "enum": ["Commercial Azure + Microsoft Cloud for Sovereignty", "Azure Government (US)", "Azure China (21Vianet)", "Sovereign / Dedicated Region", "Air-gapped / Disconnected"], "default": "Commercial Azure + Microsoft Cloud for Sovereignty" },
      "key_management":         { "type": "string", "title": "How should encryption keys be managed?", "enum": ["Microsoft-managed keys", "Customer-Managed Keys (Key Vault)", "Customer-Managed Keys (Managed HSM — FIPS 140-3 Level 3)", "On-premises HSM (BYOK)"], "default": "Customer-Managed Keys (Key Vault)" },
      "lockbox":                { "type": "string", "title": "Is Customer Lockbox required for all Microsoft support access?", "enum": ["Yes", "No"], "default": "Yes" },
      "operator_restrictions":  { "type": "string", "title": "Nationality / clearance restrictions on operators? (leave blank if none)", "description": "e.g. EU-resident staff only, Dutch nationals only" },
      "disconnected":           { "type": "string", "title": "Is disconnected / air-gapped operation required?", "enum": ["Yes", "No"], "default": "No" }
    },
    "required": ["environment", "key_management", "lockbox"]
  }
}

STEP 3 — ask_user for Software Sovereignty:
{
  "message": "Sovereign Architect — Software Sovereignty\\n\\nWhat are your software portability and vendor independence requirements?",
  "requestedSchema": {
    "properties": {
      "vendor_independence":  { "type": "string", "title": "How important is vendor independence?", "enum": ["Not required", "Preferred", "Required"], "default": "Preferred" },
      "oss_preference":       { "type": "string", "title": "Preference for open-source or open-standard technologies?", "enum": ["Yes — prefer open-source", "No preference", "No — proprietary is fine"], "default": "Yes — prefer open-source" },
      "portability":          { "type": "string", "title": "Must workloads be portable across multiple cloud providers?", "enum": ["Yes — portability required", "No"], "default": "No" },
      "hybrid":               { "type": "string", "title": "Is on-premises or hybrid deployment required?", "enum": ["Yes", "No"], "default": "No" },
      "software_restrictions": { "type": "string", "title": "Software origin, licensing, or SBOM restrictions? (leave blank if none)", "description": "e.g. no US-origin software, SBOM required" }
    },
    "required": ["vendor_independence", "oss_preference", "portability", "hybrid"]
  }
}

After all 3 ask_user calls complete, call sovereign_architect_gather_requirements with the combined answers.` };

                case "lz-setup":
                    // LZ-first path: design the Landing Zone (no prior architecture)
                    return { additionalContext: `## LZ-FIRST: Sovereign Landing Zone Design
${sess.profile ? summarizeProfile(sess.profile) : ""}

Design a complete Sovereign Landing Zone for this customer. Structure the output as:

1. **Management Groups Hierarchy** — top-level structure aligned to sovereignty boundaries and separation of concerns
2. **Subscription Design** — landing zone subscriptions (connectivity, identity, management, workload), resource organization, environment separation
3. **Sovereign Landing Zone Policy Portfolio** — which SLZ policy initiatives to apply per regulation (GDPR Baseline, NIS2, EUCS, FedRAMP, etc.)
4. **Azure Policy Assignments** — specific built-in policies, deny effects for non-compliant resources, remediation tasks
5. **Identity & Access Governance** — Entra ID structure, PIM roles, RBAC assignments, conditional access, break-glass accounts
6. **Network Topology** — hub-spoke design, Azure Firewall, Private Endpoints for all PaaS, no-public-access policies, DDoS protection
7. **Monitoring & Compliance** — Log Analytics workspace, Microsoft Sentinel, Defender for Cloud regulatory standards, compliance dashboards

Use sovereign_architect_landing_zone to fetch SLZ guidance for each topic.
When the landing zone design is presented and approved, call sovereign_architect_save_landing_zone to save it.` };

                case "designing":
                    // Step 1: workload architecture design (draft — no output artifacts yet)
                    return { additionalContext: `## STEP 1: Sovereign Architecture Design (DRAFT)
${summarizeProfile(sess.profile)}

Design a complete end-to-end sovereign architecture tailored to this profile. Structure the output as:

1. **Architecture Overview** — guiding principles and sovereignty-driven design rationale
2. **Component Design** — for each tier (compute / data / networking / identity / integration), specify:
   - The Azure service(s) recommended
   - How it satisfies data sovereignty, control plane sovereignty, and software sovereignty
3. **Sovereignty Controls Matrix** — a table mapping each component → control applied → requirement satisfied
4. **Key Design Decisions** — decisions that differ from a standard architecture because of this customer's specific sovereignty requirements

Use sovereign_architect_search_docs and sovereign_architect_cloud_services to validate service availability in the target environment.

⚠️ DO NOT write Bicep or HTML output yet — output artifacts are written ONLY after rubber-duck review and rework (final output step).

When the draft architecture is presented, call sovereign_architect_save_architecture to save the draft and proceed to the rubber-duck review phase.` };

                case "reviewing":
                    // Rubber-duck critique of the draft architecture
                    return { additionalContext: `## RUBBER-DUCK REVIEW PHASE
${summarizeProfile(sess.profile)}

**Architecture draft to critique:**
${sess.architecture?.architecture || "(see previous output)"}

Perform a thorough, adversarial rubber-duck critique of this sovereign architecture. Check every component against the customer's sovereignty profile. Specifically look for:

1. **Sovereignty gaps** — any component that does not fully satisfy data / control plane / software sovereignty requirements
2. **Missing controls** — required controls (Lockbox, CMK, private endpoints, Defender for Cloud, etc.) that are absent or incomplete
3. **Regulation compliance gaps** — specific gaps against each applicable regulation (GDPR Art. 25/32, NIS2, EUCS, FedRAMP, etc.)
4. **Network exposure risks** — any surface that should be private but is publicly accessible
5. **Identity & access risks** — over-privileged roles, missing PIM, lack of conditional access, no JIT
6. **Key management risks** — key rotation policy, backup, access policy, HSM availability zone coverage
7. **Resilience vs. data residency conflicts** — cross-region DR that may violate residency requirements
8. **Design improvements** — anything that would make the architecture more sovereign, robust, or operable

Present the full critique to the user, then call sovereign_architect_save_review with your findings.` };

                case "reworking":
                    // Incorporate review critique into improved final architecture
                    return { additionalContext: `## REWORK PHASE — Incorporate Critique Findings
${summarizeProfile(sess.profile)}

**Review findings to incorporate:**
${sess.reviewNotes || "(see review output)"}

**Original draft architecture:**
${sess.architecture?.architecture || "(see previous output)"}

Produce an improved, final architecture that addresses all findings from the rubber-duck review. For each finding either:
- **Fix it** in the redesign and note what changed, or
- **Justify** why it does not apply to this customer's profile

After presenting the reworked architecture, call sovereign_architect_finalize_architecture with:
- The final summary and complete markdown architecture
- A complete Bicep template implementing the final design (choose a descriptive filename, e.g. sovereign-vm-gdpr.bicep)

This is the final design step — sovereign_architect_finalize_architecture writes all output artifacts (HTML + Bicep) as the last action.` };

                case "landing-zone":
                    // Step 2: LZ additions on top of existing architecture
                    return { additionalContext: `## STEP 2: Landing Zone & Governance Setup
${summarizeProfile(sess.profile)}
**Architecture being supported:** ${sess.architecture?.summary || "See Step 1 output"}

Design the complete landing zone and governance structure to operate this sovereign architecture. Structure the output as:

1. **Management Groups Hierarchy** — top-level structure aligned to sovereignty boundaries and separation of concerns
2. **Subscription Design** — landing zone subscriptions (connectivity, identity, management, workload), resource organization, environment separation
3. **Sovereign Landing Zone Policy Portfolio** — which SLZ policy initiatives to apply per regulation (GDPR Baseline, NIS2, EUCS, FedRAMP, etc.), and any custom policy requirements
4. **Azure Policy Assignments** — specific built-in policies, deny effects for non-compliant resources, exemptions, and remediation tasks
5. **Identity & Access Governance** — Entra ID tenant structure, Privileged Identity Management (PIM) roles, RBAC assignments, conditional access policies, break-glass accounts
6. **Network Topology** — hub-spoke or Virtual WAN design, Azure Firewall rules, Private Endpoints for all PaaS, no-public-access policies, DDoS protection
7. **Monitoring & Compliance** — Log Analytics workspace design, Microsoft Sentinel, Defender for Cloud regulatory standards, compliance dashboard, alert rules

Use sovereign_architect_landing_zone to fetch SLZ guidance for each topic before designing.
When the landing zone is presented and approved, call sovereign_architect_save_landing_zone to finalize.` };

                case "complete":
                    // Workflow done — inject compact context for revisions and deep-dives
                    if (isSovereignTopic || isDesignIntent) {
                        return { additionalContext: `Sovereign Architect workflow complete. Customer context for revisions:\n\n${summarizeProfile(sess.profile)}\n\n**Architecture:** ${sess.architecture?.summary || ""}\n**Landing Zone:** ${sess.landingZone?.summary || ""}` };
                    }
                    break;

                case "idle":
                    if (isSovereignTopic && isDesignIntent) {
                        if (sess.lzExists && sess.profile) {
                            // LZ defined + profile gathered (e.g. after LZ-first path) → go straight to workload design
                            sess.state = "designing";
                            return { additionalContext: "Sovereign Landing Zone is already in place and sovereignty profile is captured. Proceeding directly to sovereign workload architecture design." };
                        } else if (sess.lzExists) {
                            // LZ confirmed but no profile yet → gather profile using structured ask_user forms
                            sess.state = "gathering";
                            return { additionalContext: "Sovereign Landing Zone is already in place. Start gathering sovereignty requirements by calling ask_user 3 times (one per pillar). Follow the ask_user templates in the gathering instructions exactly." };
                        } else {
                            // First interaction — validate LZ status before anything else
                            sess.state = "validating-lz";
                            return { additionalContext: `⚠️ VALIDATION REQUIRED before proceeding. Ask the customer exactly this question first:

"Do you already have a Sovereign Landing Zone and Management Group hierarchy in place? (y/n)"

Wait for their answer, then:
- If YES → ask: "Would you like to continue designing a sovereign workload?"
- If NO  → ask: "Would you like to start by defining a new Sovereign Landing Zone?"

Then call sovereign_architect_confirm_environment with their answers.` };
                        }
                    }
                    break;
            }
        },
    },
});
