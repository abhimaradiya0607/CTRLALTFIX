"use client";

import { useState } from "react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";

import {
  Check,
  ChevronRight,
  Clock,
  Code,
  Globe,
  Plus,
  Search,
  Server,
  Star,
  Zap,
} from "lucide-react";

type TemplateSelectionModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    template:
      | "REACT"
      | "NEXTJS"
      | "EXPRESS"
      | "VUE"
      | "HONO"
      | "ANGULAR";
    description?: string;
  }) => void;
};

interface TemplateOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  popularity: number;
  tags: string[];
  features: string[];
  category: "frontend" | "backend" | "fullstack";
}

const templates: TemplateOption[] = [
  {
    id: "react",
    name: "React",
    description:
      "A JavaScript library for building user interfaces with component-based architecture",
    icon: "/react.svg",
    color: "#61DAFB",
    popularity: 5,
    tags: ["UI", "Frontend", "JavaScript"],
    features: ["Component-Based", "Virtual DOM", "JSX Support"],
    category: "frontend",
  },
  {
    id: "nextjs",
    name: "Next.js",
    description:
      "The React framework for production with server-side rendering and static site generation",
    icon: "/nextjs-icon.svg",
    color: "#000000",
    popularity: 4,
    tags: ["React", "SSR", "Fullstack"],
    features: [
      "Server Components",
      "API Routes",
      "File-based Routing",
    ],
    category: "fullstack",
  },
  {
    id: "express",
    name: "Express",
    description:
      "Fast, unopinionated, minimalist web framework for Node.js to build APIs and web applications",
    icon: "/expressjs-icon.svg",
    color: "#000000",
    popularity: 4,
    tags: ["Node.js", "API", "Backend"],
    features: ["Middleware", "Routing", "HTTP Utilities"],
    category: "backend",
  },
  {
    id: "vue",
    name: "Vue.js",
    description:
      "Progressive JavaScript framework for building user interfaces with an approachable learning curve",
    icon: "/vuejs-icon.svg",
    color: "#4FC08D",
    popularity: 4,
    tags: ["UI", "Frontend", "JavaScript"],
    features: [
      "Reactive Data Binding",
      "Component System",
      "Virtual DOM",
    ],
    category: "frontend",
  },
  {
    id: "hono",
    name: "Hono",
    description:
      "Fast, lightweight, built on Web Standards. Support for any JavaScript runtime.",
    icon: "/hono.svg",
    color: "#e36002",
    popularity: 3,
    tags: ["Node.js", "TypeScript", "Backend"],
    features: [
      "Dependency Injection",
      "TypeScript Support",
      "Modular Architecture",
    ],
    category: "backend",
  },
  {
    id: "angular",
    name: "Angular",
    description:
      "Angular is a web framework that empowers developers to build fast, reliable applications.",
    icon: "/angular-2.svg",
    color: "#DD0031",
    popularity: 3,
    tags: ["React", "Fullstack", "JavaScript"],
    features: [
      "Reactive Data Binding",
      "Component System",
      "Virtual DOM",
      "Dependency Injection",
      "TypeScript Support",
    ],
    category: "fullstack",
  },
];

const ACCENT = "#A3E635";
const ACCENT_HOVER = "#84CC16";

const TemplateSelectionModal = ({
  isOpen,
  onClose,
  onSubmit,
}: TemplateSelectionModalProps) => {
  const [step, setStep] = useState<"select" | "configure">("select");

  const [selectedTemplate, setSelectedTemplate] = useState<
    string | null
  >(null);

  const [searchQuery, setSearchQuery] = useState("");

  const [category, setCategory] = useState<
    "all" | "frontend" | "backend" | "fullstack"
  >("all");

  const [projectName, setProjectName] = useState("");

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplate(templateId);
  };

  const filteredTemplates = templates.filter((template) => {
    const query = searchQuery.toLowerCase();

    const matchesSearch =
      template.name.toLowerCase().includes(query) ||
      template.description.toLowerCase().includes(query) ||
      template.tags.some((tag) =>
        tag.toLowerCase().includes(query),
      );

    const matchesCategory =
      category === "all" || template.category === category;

    return matchesSearch && matchesCategory;
  });

  const handleContinue = () => {
    if (selectedTemplate) {
      setStep("configure");
    }
  };

  const handleCreateProject = () => {
    if (!selectedTemplate) return;

    const templateMap: Record<
      string,
      | "REACT"
      | "NEXTJS"
      | "EXPRESS"
      | "VUE"
      | "HONO"
      | "ANGULAR"
    > = {
      react: "REACT",
      nextjs: "NEXTJS",
      express: "EXPRESS",
      vue: "VUE",
      hono: "HONO",
      angular: "ANGULAR",
    };

    const template = templates.find(
      (t) => t.id === selectedTemplate,
    );

    onSubmit({
      title: projectName || `New ${template?.name} Project`,
      template: templateMap[selectedTemplate] || "REACT",
      description: template?.description,
    });

    onClose();

    setStep("select");
    setSelectedTemplate(null);
    setProjectName("");
  };

  const handleBack = () => {
    setStep("select");
  };

  const handleClose = () => {
    onClose();
    setStep("select");
    setSelectedTemplate(null);
    setProjectName("");
    setSearchQuery("");
    setCategory("all");
  };

  const renderStars = (count: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        size={14}
        className={
          i < count
            ? "fill-yellow-400 text-yellow-400"
            : "text-white/20"
        }
      />
    ));
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        {step === "select" ? (
          <>
            <DialogHeader>
              <DialogTitle
                className="flex items-center gap-2 text-2xl font-bold"
                style={{ color: ACCENT }}
              >
                <Plus size={24} style={{ color: ACCENT }} />
                Select a Template
              </DialogTitle>

              <DialogDescription>
                Choose a template to create your new playground.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-6 py-4">
              {/* Search + Category */}
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="relative flex-1">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    size={18}
                  />

                  <Input
                    placeholder="Search templates..."
                    value={searchQuery}
                    onChange={(e) =>
                      setSearchQuery(e.target.value)
                    }
                    className="pl-10 focus-visible:ring-[#A3E635]"
                  />
                </div>

                <Tabs
                  value={category}
                  className="w-full sm:w-auto"
                  onValueChange={(value) =>
                    setCategory(
                      value as
                        | "all"
                        | "frontend"
                        | "backend"
                        | "fullstack",
                    )
                  }
                >
                  <TabsList className="grid w-full grid-cols-4 sm:w-[400px]">
                    <TabsTrigger
                      value="all"
                      className="data-[state=active]:bg-[#A3E635] data-[state=active]:text-black"
                    >
                      All
                    </TabsTrigger>

                    <TabsTrigger
                      value="frontend"
                      className="data-[state=active]:bg-[#A3E635] data-[state=active]:text-black"
                    >
                      Frontend
                    </TabsTrigger>

                    <TabsTrigger
                      value="backend"
                      className="data-[state=active]:bg-[#A3E635] data-[state=active]:text-black"
                    >
                      Backend
                    </TabsTrigger>

                    <TabsTrigger
                      value="fullstack"
                      className="data-[state=active]:bg-[#A3E635] data-[state=active]:text-black"
                    >
                      Fullstack
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {/* Templates */}
              <RadioGroup
                value={selectedTemplate || ""}
                onValueChange={handleSelectTemplate}
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {filteredTemplates.length > 0 ? (
                    filteredTemplates.map((template) => {
                      const isSelected =
                        selectedTemplate === template.id;

                      return (
                        <div
                          key={template.id}
                          className={`group relative flex cursor-pointer rounded-xl border p-6 transition-all duration-200 ${
                            isSelected
                              ? "border-[#A3E635] bg-[#A3E635]/[0.04] shadow-[0_0_0_1px_#A3E635,0_8px_24px_rgba(163,230,53,0.12)]"
                              : "border-border hover:border-[#A3E635]/60 hover:bg-[#A3E635]/[0.025] hover:shadow-[0_8px_24px_rgba(163,230,53,0.08)]"
                          }`}
                          onClick={() =>
                            handleSelectTemplate(template.id)
                          }
                        >
                          {/* Stars */}
                          <div className="absolute right-4 top-4 flex gap-1">
                            {renderStars(
                              template.popularity,
                            )}
                          </div>

                          {/* Selected Indicator */}
                          {isSelected && (
                            <div
                              className="absolute left-2 top-2 rounded-full p-1 text-black"
                              style={{
                                backgroundColor: ACCENT,
                              }}
                            >
                              <Check size={14} />
                            </div>
                          )}

                          <div className="flex gap-4">
                            {/* Icon */}
                            <div
                              className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl border border-border/50"
                              style={{
                                backgroundColor: `${template.color}15`,
                              }}
                            >
                              <Image
                                src={
                                  template.icon ||
                                  "/placeholder.svg"
                                }
                                alt={`${template.name} icon`}
                                width={40}
                                height={40}
                                className="object-contain"
                              />
                            </div>

                            {/* Details */}
                            <div className="flex min-w-0 flex-1 flex-col">
                              <div className="mb-1 flex items-center gap-2">
                                <h3 className="text-lg font-semibold">
                                  {template.name}
                                </h3>

                                <div className="flex gap-1">
                                  {template.category ===
                                    "frontend" && (
                                    <Code
                                      size={14}
                                      className="text-blue-500"
                                    />
                                  )}

                                  {template.category ===
                                    "backend" && (
                                    <Server
                                      size={14}
                                      className="text-emerald-500"
                                    />
                                  )}

                                  {template.category ===
                                    "fullstack" && (
                                    <Globe
                                      size={14}
                                      className="text-violet-500"
                                    />
                                  )}
                                </div>
                              </div>

                              <p className="mb-3 text-sm text-muted-foreground">
                                {template.description}
                              </p>

                              <div className="mt-auto flex flex-wrap gap-2">
                                {template.tags.map(
                                  (tag) => (
                                    <span
                                      key={tag}
                                      className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors group-hover:border-[#A3E635]/30"
                                    >
                                      {tag}
                                    </span>
                                  ),
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Radio */}
                          <RadioGroupItem
                            value={template.id}
                            id={template.id}
                            className="sr-only"
                          />
                        </div>
                      );
                    })
                  ) : (
                    <div className="col-span-2 flex flex-col items-center justify-center p-8 text-center">
                      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#A3E635]/10">
                        <Search
                          size={28}
                          className="text-[#A3E635]/60"
                        />
                      </div>

                      <h3 className="text-lg font-medium">
                        No templates found
                      </h3>

                      <p className="text-sm text-muted-foreground">
                        Try adjusting your search or filters
                      </p>
                    </div>
                  )}
                </div>
              </RadioGroup>
            </div>

            {/* Footer */}
            <div className="mt-4 flex flex-col justify-between gap-3 border-t pt-4 sm:flex-row">
              <div className="flex items-center text-sm text-muted-foreground">
                <Clock size={14} className="mr-1" />

                <span>
                  Estimated setup time:{" "}
                  {selectedTemplate
                    ? "2-5 minutes"
                    : "Select a template"}
                </span>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={handleClose}
                >
                  Cancel
                </Button>

                <Button
                  disabled={!selectedTemplate}
                  onClick={handleContinue}
                  className="text-black transition-colors hover:bg-[#84CC16]"
                  style={{
                    backgroundColor: ACCENT,
                  }}
                >
                  Continue
                  <ChevronRight
                    size={16}
                    className="ml-1"
                  />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Configuration Step */}
            <DialogHeader>
              <DialogTitle
                className="text-2xl font-bold"
                style={{ color: ACCENT }}
              >
                Configure Your Project
              </DialogTitle>

              <DialogDescription>
                {
                  templates.find(
                    (t) => t.id === selectedTemplate,
                  )?.name
                }{" "}
                project configuration
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-6 py-4">
              {/* Project Name */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="project-name">
                  Project Name
                </Label>

                <Input
                  id="project-name"
                  placeholder="my-awesome-project"
                  value={projectName}
                  onChange={(e) =>
                    setProjectName(e.target.value)
                  }
                  className="focus-visible:ring-[#A3E635]"
                />
              </div>

              {/* Features */}
              <div className="rounded-xl border border-[#A3E635]/20 bg-[#A3E635]/[0.025] p-4">
                <h3 className="mb-3 font-medium">
                  Selected Template Features
                </h3>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {templates
                    .find(
                      (t) => t.id === selectedTemplate,
                    )
                    ?.features.map((feature) => (
                      <div
                        key={feature}
                        className="flex items-center gap-2"
                      >
                        <Zap
                          size={14}
                          style={{ color: ACCENT }}
                        />

                        <span className="text-sm">
                          {feature}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Configuration Footer */}
            <div className="mt-4 flex justify-between gap-3 border-t pt-4">
              <Button
                variant="outline"
                onClick={handleBack}
              >
                Back
              </Button>

              <Button
                onClick={handleCreateProject}
                className="text-black transition-colors hover:bg-[#84CC16]"
                style={{
                  backgroundColor: ACCENT,
                }}
              >
                Create Project
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TemplateSelectionModal;