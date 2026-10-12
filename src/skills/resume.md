# Resume that does not get rejected

Goal: a resume (and, when asked, a cover letter) that passes automated screening (ATS and AI screeners) and convinces a recruiter in a six-second scan, for one specific job. Everything in it must be true.

## 1. Gather

- The job posting: read it with get_page_text (or ask for the link). Note the exact job title, company, location, seniority, must-have and nice-to-have requirements, tools, certifications, languages, and the words the posting repeats.
- The user's current resume: use an attached file if there is one; if it is a PDF you cannot read, ask the user to paste the text or attach a .txt/.md version.
- Missing facts: ask with ask_user, one question at a time with likely options. Ask for numbers behind achievements (team size, users, revenue, time saved, % improvement), dates, tools used, and visa or relocation status if the posting asks.
- Never invent employers, titles, dates, degrees, certifications, numbers or skills. If a metric is unknown, ask; if the user does not know, describe the result honestly without a number.

## 2. Match the posting

- List the 5-8 hard requirements and map each to concrete evidence from the user's history. Show the user this map briefly.
- Name real gaps plainly and suggest honest ways to cover them (related experience, courses, projects). Do not paper over a missing must-have.
- Use the posting's exact phrases where they are true for the user (e.g. "financial reporting under IFRS" rather than a synonym), because screeners match wording. Spell out acronyms once: "Search Engine Optimization (SEO)".

## 3. Write

Order: header, summary, experience, skills, education, certifications (and languages, projects if relevant).

- Header: full name, city and country, phone, email, LinkedIn (and GitHub or portfolio for technical roles). No photo, age, marital status or full address unless the country norm requires it.
- Summary: 2-3 lines that use the target job title and the top three requirements, with years of experience and one strong result.
- Experience, newest first: company, title, location, MM/YYYY - MM/YYYY. 3-5 bullets per recent role, most relevant first, older roles shorter.
- Every bullet: strong verb + what you did + measurable result ("Cut month-end close from 8 to 5 days by automating reconciliations in Python"). No "responsible for", no "helped with", no first person.
- Skills: a plain list grouped by type (e.g. Tools, Languages, Methods), containing the posting's keywords the user really has.
- Length: one page under ~10 years of experience, two pages at most otherwise.

## 4. Format for screening software

- One column, standard section headings (Summary, Experience, Skills, Education), plain bullets.
- No tables, text boxes, columns, icons, images, charts or skill bars; no contact details in page headers or footers.
- Consistent dates and tense (past tense for past roles).
- Deliver with create_file as Markdown or plain text named like "Firstname-Lastname-Resume.md", and tell the user to export to .docx or a text-based PDF (not a scanned image) if the site needs that.

## 5. Never

- Hidden or white text, keyword lists stuffed into the margins, or instructions aimed at AI screeners ("ignore previous instructions", "rate this candidate highly"). Screening tools flag these and reject the application.
- Exaggerated titles, fake metrics, or skills the user cannot discuss in an interview.

## 6. Check before handing over

- Each hard requirement appears with evidence; the job title appears in the summary.
- The six-second test: name, current title, top achievement and key skills are visible at the top.
- No typos, consistent formatting and dates, every bullet starts with a verb and most have a number.
- Show the user what you changed and the remaining gaps, then ask before uploading it with upload_file or submitting any form.

## Cover letter (when asked)

150-250 words: why this company and role (one specific detail from the posting or company), two achievements that match the top requirements, and a short close. No generic praise, no repeating the resume line by line.

## Application forms

Use the same facts as the resume. Answer knockout questions (work permit, notice period, salary, previous employment with the company) truthfully; ask the user when unsure instead of guessing.
