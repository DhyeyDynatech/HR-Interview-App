"use client";

import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Check } from "lucide-react";
import { Interview } from "@/types/interview";

interface AddJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  interviews: Interview[];
  selectedJobIds: string[];
  onAddJobs: (interviewIds: string[]) => void;
}

export default function AddJobDialog({
  open,
  onOpenChange,
  interviews,
  selectedJobIds,
  onAddJobs,
}: AddJobDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const availableInterviews = useMemo(() => {
    return interviews.filter(
      (i) =>
        !selectedJobIds.includes(i.id) &&
        (i.name || "").toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [interviews, selectedJobIds, searchTerm]);

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAdd = () => {
    if (checkedIds.size > 0) {
      onAddJobs(Array.from(checkedIds));
    }
    setCheckedIds(new Set());
    setSearchTerm("");
    onOpenChange(false);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setCheckedIds(new Set());
      setSearchTerm("");
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Jobs</DialogTitle>
          <DialogDescription>
            Select interviews to add to your ATS scoring dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search interviews..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        <ScrollArea className="max-h-[300px] border rounded-md">
          {availableInterviews.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-500">
              {searchTerm
                ? "No matching interviews found."
                : "All interviews have been added."}
            </div>
          ) : (
            <div className="divide-y">
              {availableInterviews.map((interview) => {
                const isChecked = checkedIds.has(interview.id);
                return (
                  <button
                    key={interview.id}
                    onClick={() => toggleCheck(interview.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors ${
                      isChecked ? "bg-indigo-50" : ""
                    }`}
                  >
                    <div
                      className={`flex-shrink-0 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                        isChecked
                          ? "bg-indigo-500 border-indigo-500"
                          : "border-slate-300"
                      }`}
                    >
                      {isChecked && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <span className="text-sm font-medium flex-1 truncate">
                      {interview.name || "Untitled"}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        interview.is_active
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-slate-50 text-slate-500 border-slate-200"
                      }`}
                    >
                      {interview.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={checkedIds.size === 0}>
            Add Selected ({checkedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
