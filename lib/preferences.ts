export type AiCategory = {
  id: string;
  label: string;
  description: string;
  icon: string;
  isHot?: boolean;
};

export type DeliveryCadence = "daily" | "weekly" | "breaking" | "biweekly";

export type UserPreferences = {
  fullName: string;
  categories: string[];
  cadence: DeliveryCadence;
  deliveryTime: string;
  timezone: string;
  email: string;
};

export const AI_CATEGORIES: AiCategory[] = [
  {
    id: "llms",
    label: "LLMs",
    description: "Most active",
    icon: "LM",
  },
  {
    id: "generative-ai",
    label: "Generative AI",
    description: "Images, video, audio",
    icon: "GA",
    isHot: true,
  },
  {
    id: "agents",
    label: "AI agents",
    description: "Automation",
    icon: "AG",
    isHot: true,
  },
  {
    id: "computer-vision",
    label: "Computer vision",
    description: "Image and video",
    icon: "CV",
  },
  {
    id: "robotics",
    label: "Robotics",
    description: "Embodied AI",
    icon: "RB",
  },
  {
    id: "security",
    label: "AI security",
    description: "Safety and red-teaming",
    icon: "SC",
  },
  {
    id: "healthcare",
    label: "AI in healthcare",
    description: "Med and biotech",
    icon: "HC",
  },
  {
    id: "hardware",
    label: "AI hardware",
    description: "Chips and compute",
    icon: "HW",
  },
  {
    id: "policy",
    label: "AI policy",
    description: "Regulation and ethics",
    icon: "PL",
  },
  {
    id: "mlops",
    label: "MLOps",
    description: "Deploy and infra",
    icon: "MO",
  },
  {
    id: "education",
    label: "AI in education",
    description: "EdTech and learning",
    icon: "ED",
  },
  {
    id: "open-source",
    label: "Open source AI",
    description: "Models and tools",
    icon: "OS",
  },
];

export const CADENCE_OPTIONS: Array<{
  id: DeliveryCadence;
  label: string;
  description: string;
}> = [
  {
    id: "daily",
    label: "Daily",
    description: "Every morning at 8am",
  },
  {
    id: "weekly",
    label: "Weekly",
    description: "Monday morning recap",
  },
  {
    id: "breaking",
    label: "As it happens",
    description: "Breaking stories only",
  },
  {
    id: "biweekly",
    label: "Bi-weekly",
    description: "Every two weeks",
  },
];

export const DEFAULT_PREFERENCES: UserPreferences = {
  fullName: "",
  categories: ["llms", "generative-ai", "agents"],
  cadence: "daily",
  deliveryTime: "08:00",
  timezone: "UTC",
  email: "",
};
