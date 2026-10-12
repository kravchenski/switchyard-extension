import resume from './resume.md' with { type: 'text' };

export interface Skill {
    name: string;
    description: string;
    instructions: string;
}

/** Instructions the agent loads with use_skill when a task matches, like Claude Code skills. */
export const SKILLS: Skill[] = [
    {
        name: 'resume',
        description: 'Write or tailor a resume, CV or cover letter for a specific job posting so it passes ATS and recruiter screening, and fill job application forms.',
        instructions: resume,
    },
];
