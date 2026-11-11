// ── SPS methodology (Cabinet Division, "সেবা সহজীকরণ নির্দেশিকা ২০২৬") ─────────────
//
// The guideline as data and a compact instruction pack. SPS_GUIDE goes into the system
// prompt of every agent (mapping, review, TO-BE, chat); the lists define the official
// worksheets (ছক) the agents fill and the calculators / checks use.

/** ছক-৫: the 20 aspects every problem / proposal analysis goes through */
export const SPS_ASPECTS: Array<{ key: string; en: string; bn: string }> = [
  { key: "info", en: "Citizen access to service information", bn: "নাগরিকের সেবা-সম্পর্কিত তথ্য সংগ্রহ" },
  { key: "form", en: "Application form (information and documents)", bn: "আবেদন ফর্ম (তথ্য এবং দাখিলিয় কাগজাদি)" },
  { key: "autofill", en: "Automatic filling of the application", bn: "আবেদনপত্রে তথ্য স্বয়ংক্রিয়ভাবে পূরণ" },
  { key: "submission", en: "Submitting the application", bn: "আবেদন দাখিল" },
  { key: "office_docs", en: "Papers used by the office", bn: "অফিস কর্তৃক ব্যবহৃত কাগজাদি" },
  { key: "fee", en: "Paying the service fee", bn: "সেবার ফি প্রদান" },
  { key: "inspection", en: "Inspection / verification", bn: "সেবা-সংশ্লিষ্ট তদন্ত কার্যক্রম" },
  { key: "delivery", en: "Collecting the final document / output", bn: "প্রক্রিয়া শেষে সেবার ডকুমেন্ট সংগ্রহ" },
  { key: "steps", en: "Number of process steps", bn: "সেবার ধাপসমূহ" },
  { key: "rules", en: "Rules and regulations of the service", bn: "সেবা গ্রহণের নিয়মাবলি" },
  { key: "staff", en: "Officers and staff (behaviour, capacity)", bn: "সেবা-সংশ্লিষ্ট কর্মকর্তা-কর্মচারী" },
  { key: "unexpected_cost", en: "Unexpected cost (middlemen etc.)", bn: "অপ্রত্যাশিত খরচ" },
  { key: "feedback", en: "Giving feedback on the service", bn: "সেবা সম্পর্কে মতামত প্রদান" },
  { key: "grievance", en: "Complaints and redress (GRS)", bn: "অভিযোগ দাখিলের সুযোগ ও প্রতিকার প্রাপ্তি" },
  { key: "disability", en: "Service for persons with disabilities", bn: "প্রতিবন্ধী ব্যক্তি হিসাবে সেবা গ্রহণ" },
  { key: "hotline", en: "Hotline / call centre", bn: "হটলাইন (কল সেন্টার ইত্যাদি)" },
  { key: "tracking", en: "Online tracking", bn: "অনলাইন ট্র্যাকিং সিস্টেম" },
  { key: "data_from_servers", en: "Getting data from other servers", bn: "অন্য সার্ভার থেকে তথ্য সংগ্রহের সুযোগ" },
  { key: "auto_verify", en: "Automatic verification of data / documents from other servers", bn: "অন্য সার্ভার থেকে স্বয়ংক্রিয়ভাবে তথ্য/ডকুমেন্টস যাচাই" },
  { key: "monitoring", en: "Monitoring delivery within the set time (dashboard)", bn: "নির্ধারিত সময়ের মধ্যে সেবা প্রদান মনিটরিং" },
];

/** ছক-১: service delivery profile (checkbox items) */
export const SPS_PROFILE: Array<{ key: string; en: string; bn: string; options: string[] }> = [
  { key: "file_method", en: "File processing", bn: "নথি প্রক্রিয়াকরণ পদ্ধতি", options: ["D-Nothi", "Manual", "Hybrid", "Other"] },
  { key: "service_type", en: "Type of service delivery", bn: "সেবা প্রদানের ধরন", options: ["Manual", "Digital", "Hybrid", "Other"] },
  { key: "channel", en: "Delivery channel", bn: "সেবা প্রদানের মাধ্যম", options: ["Citizen portal", "Mobile app", "In person at office", "Post", "E-mail", "Digital centre", "Other"] },
  { key: "fee_payment", en: "Fee payment", bn: "সেবাগ্রহীতা কর্তৃক ফি পরিশোধ", options: ["Over the counter", "MFS", "Online banking", "Card", "A-Challan", "Ek-Pay", "No fee", "Other"] },
  { key: "hotline", en: "Hotline", bn: "হটলাইন", options: ["333", "Other", "None"] },
  { key: "info_available", en: "Service information available to citizens", bn: "সেবা-সম্পর্কিত প্রয়োজনীয় তথ্য নাগরিকের নিকট উপস্থাপনের ব্যবস্থা", options: ["Yes", "No"] },
  { key: "self_service", en: "Citizen can apply by themselves", bn: "নাগরিকের নিজে সেবা গ্রহণের সুবিধা", options: ["Yes", "No"] },
  { key: "agent", en: "Application help (UDC, service assistant)", bn: "আবেদন প্রক্রিয়াকরণ এজেন্ট (ইউডিসি, সেবা সহায়তাকারী)", options: ["Yes", "No"] },
  { key: "accessibility", en: "Special arrangement for persons with disabilities / elderly", bn: "প্রতিবন্ধী ব্যক্তি/প্রবীণদের জন্য বিশেষ ব্যবস্থা", options: ["Yes", "No"] },
  { key: "autofill", en: "Application auto-filled (digital service)", bn: "আবেদনপত্রের তথ্য স্বয়ংক্রিয়ভাবে পূরণ", options: ["Full", "Partial", "No"] },
  { key: "tracking", en: "Online tracking", bn: "অনলাইন ট্র্যাকিং সিস্টেম", options: ["Yes", "No"] },
  { key: "data_from_servers", en: "Data collected from other servers", bn: "অন্য সার্ভার থেকে তথ্য সংগ্রহের সুযোগ", options: ["Full", "Partial", "No"] },
  { key: "auto_verify", en: "Automatic verification from other servers", bn: "অন্য সার্ভার থেকে স্বয়ংক্রিয়ভাবে তথ্য/ডকুমেন্টস যাচাই", options: ["Full", "Partial", "No"] },
  { key: "online_feedback", en: "Online feedback on the service", bn: "অনলাইনে সেবা সম্পর্কে মতামত প্রদানের সুযোগ", options: ["Yes", "No"] },
  { key: "dashboard", en: "Dashboard monitoring of delivery time", bn: "নির্ধারিত সময়ে সেবা প্রদান ড্যাশবোর্ডে পরিবীক্ষণ", options: ["Yes", "No"] },
];

/** ম্যাট্রিক্স-২: service priority criteria (score options as given in the guideline) */
export const SPS_PRIORITY: Array<{ key: string; en: string; bn: string; scale: Array<[number, string]> }> = [
  { key: "users", en: "Number of service users (2-year average)", bn: "সেবা সেবাগ্রহীতার সংখ্যা", scale: [[1, "Few"], [2, "Considerable"], [3, "Many"]] },
  { key: "level", en: "Level of delivery", bn: "সেবা প্রদানের পর্যায়", scale: [[1, "Central"], [2, "Regional / divisional"], [3, "District"], [4, "Upazila"], [5, "Union / municipality"]] },
  { key: "inclusive", en: "How inclusive is it? (disadvantaged, disabled, women, children)", bn: "সেবাটি কতটা অন্তর্ভুক্তিমূলক?", scale: [[1, "Not at all"], [2, "Somewhat"], [3, "Fully"]] },
  { key: "delay", en: "Longer than expected?", bn: "প্রত্যাশিত সময়ের চেয়ে কতটা বেশি সময় লেগেছে?", scale: [[1, "Little"], [2, "Somewhat"], [3, "Much"]] },
  { key: "cost", en: "Costlier than expected (citizen and office)?", bn: "প্রত্যাশার চেয়ে বেশি খরচ হচ্ছে কি?", scale: [[1, "Little"], [2, "Somewhat"], [3, "Much"]] },
  { key: "visits", en: "More office visits than needed?", bn: "প্রয়োজনের চেয়ে বেশিবার অফিসে আসতে হয় কি?", scale: [[1, "Little"], [2, "Somewhat"], [3, "Much"]] },
  { key: "offices", en: "Several offices involved?", bn: "সেবা প্রদানে একাধিক দপ্তরের সংশ্লিষ্টতা আছে কি?", scale: [[1, "None"], [2, "Two"], [3, "More than two"]] },
  { key: "documents", en: "Amount of documents required", bn: "সেবা প্রাপ্তিতে প্রয়োজনীয় কাগজপত্রের পরিমাণ", scale: [[1, "Few"], [2, "Somewhat"], [3, "Many"]] },
  { key: "mode", en: "How is it done?", bn: "সেবাটি কোন প্রক্রিয়ায় সম্পাদন করতে হয়?", scale: [[1, "Fully online"], [2, "Hybrid"], [3, "Manual"]] },
];

/** ম্যাট্রিক্স-৩: citizen feedback questions (1 = very dissatisfied … 5 = very satisfied) */
export const SPS_FEEDBACK: Array<{ key: string; en: string; bn: string }> = [
  { key: "info", en: "Getting service information", bn: "সেবা-সম্পর্কিত তথ্য সংগ্রহ" },
  { key: "form", en: "Filling the application form", bn: "সেবার আবেদন ফর্ম পূরণ" },
  { key: "documents", en: "Collecting the documents named in the form", bn: "ফর্মে উল্লেখিত কাগজাদি সংগ্রহ" },
  { key: "submission", en: "Submitting the application", bn: "আবেদনপত্র দাখিল" },
  { key: "fee", en: "Paying the fee", bn: "সেবার ফি প্রদান" },
  { key: "inspection", en: "Inspection", bn: "সেবা-সংশ্লিষ্ট তদন্ত কার্যক্রম" },
  { key: "delivery", en: "Collecting the final document", bn: "প্রক্রিয়া শেষে সেবার ডকুমেন্ট সংগ্রহ" },
  { key: "rules", en: "Rules of the service", bn: "সেবা গ্রহণের নিয়মাবলি" },
  { key: "staff", en: "Officers and staff", bn: "সেবা সম্পৃক্ত কর্মকর্তা-কর্মচারী" },
  { key: "cost", en: "Cost of getting the service", bn: "সেবা প্রাপ্তিতে খরচ" },
  { key: "time", en: "Time to get the service", bn: "সেবা প্রাপ্তিতে সময়" },
  { key: "visits", en: "Visits to get the service", bn: "সেবা প্রাপ্তিতে যাতায়াত" },
  { key: "grievance", en: "Complaint and redress", bn: "অভিযোগ দাখিলের সুযোগ ও প্রতিকার প্রাপ্তি" },
  { key: "disability", en: "Service for persons with disabilities", bn: "প্রতিবন্ধী ব্যক্তির সেবা গ্রহণ" },
];

/** ম্যাট্রিক্স-৩ classification of the total score (14–70) */
export function feedbackClass(total: number): { key: "friendly" | "needed" | "urgent"; en: string; bn: string } {
  if (total >= 56) return { key: "friendly", en: "Citizen-friendly", bn: "নাগরিকবান্ধব" };
  if (total >= 36) return { key: "needed", en: "SPS needed", bn: "এসপিএস-এর প্রয়োজনীয়তা রয়েছে" };
  return { key: "urgent", en: "Urgent — start SPS immediately", bn: "অবিলম্বে এসপিএস উদ্যোগ প্রয়োজন" };
}

/** The guideline as instructions for every agent (stable text — part of the cached prompt) */
export const SPS_GUIDE = `SPS METHOD (Cabinet Division, Bangladesh: "Service Simplification Guideline 2026"). Follow it.
Framework: AS-IS design → analyse & evaluate → identify best practice → TO-BE design → implementation → continuous improvement.
Principles: fundamental rethinking, radical redesign, dramatic improvement. Base everything on the citizen's real experience, not only the office's view.

Measure in TCVQ (Time, Cost, Visit, Quality):
- Time in WORKING DAYS from application to receiving the service; every step has a performer (P: designation) and a time (T).
- Visit = each time the citizen must come to an office in person.
- Citizen cost in taka = per visit (fare + food + lost daily wage, + companion if needed) + fees + unexpected cost (e.g. middlemen).
- Documents = number of papers the citizen must submit. Office view: office cost, steps, staff involved, committees, quality (behaviour, accuracy, on-time delivery), place of service.

Process steps have a type: activity (rectangle), decision (diamond — approve/verify, "No" loops back to an earlier step), document (a paper is attached/submitted), message (a letter/SMS/notice is sent).

Design rules (TO-BE):
- Every AS-IS step ends as kept, merged or removed ("প্রয়োজন নাই") — with a reason.
- A legally required step is kept but simplified; a step that adds no value is removed.
- Never ask the citizen twice for the same information or a document another office / server already holds — fetch or verify it digitally (NID, birth registration, trade licence, tax, etc.).
- Replace manual letters and physical verification with server integration / auto-verification where possible.
- Replace visits made only to get information, pay a fee or collect the result with portal info, SMS, online payment (Ek-Pay, A-Challan, MFS) and online delivery.
- Remove intermediaries/brokers; offer official help (UDC / digital centre / help desk) for citizens without digital skills.
- Cut layered approvals to one decision point.
- Keep several channels (online, in person, digital centre, post, mobile) — inclusive and accessible for persons with disabilities, elderly, women, children.
- Provide tracking, notifications (SMS), online feedback, GRS complaint access (grs.gov.bd), hotline (333) and dashboard monitoring of delivery time.
Never: just move the existing complicated process online (if unnecessary steps, approvals, repeated checks or papers remain, it is not simplification); keep a step that creates room for middlemen or hidden cost; choose the office's convenience over the citizen's hardship.
Policy anchors: Secretariat Instructions 2024 (instruction 267: simplify/digitise all services; 263: citizen charter with standard time, transparency, choice, courtesy, grievance, simple application, value for money), GPMS (reduce time, cost, visits, personal contact), Innovation Team circular 2025, GRS guideline 2015 (rev. 2018): simplify the most-complained services first.`;
