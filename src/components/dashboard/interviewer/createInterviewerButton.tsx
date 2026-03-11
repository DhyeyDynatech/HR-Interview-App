"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useInterviewers } from "@/contexts/interviewers.context";
import { useToast } from "@/components/ui/use-toast";
import axios from "axios";
import { Plus, Loader2 } from "lucide-react";
import { useState } from "react";

function CreateInterviewerButton() {
  const [isLoading, setIsLoading] = useState(false);
  const { interviewers, setInterviewers, setInterviewersLoading } = useInterviewers();
  const { toast } = useToast();

  const createInterviewers = async () => {
    // Prevent multiple clicks
    if (isLoading) {
      return;
    }

    // Check if interviewers already exist
    if (interviewers.length > 0) {
      toast({
        title: "Interviewers already exist",
        description: "Default interviewers have already been created.",
        variant: "default",
      });

      return;
    }

    try {
      setIsLoading(true);
      
      const response = await axios.get("/api/create-interviewer");
      console.log("Interviewers created:", response.data);

      // Show success message
      toast({
        title: "Success!",
        description: "Default interviewers (Lisa & Bob) have been created.",
        variant: "default",
      });

      // Refresh the interviewers list
      setInterviewersLoading(true);
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      if (user.id) {
        const { InterviewerService } = await import("@/services/interviewers.service");
        const updatedInterviewers = await InterviewerService.getAllInterviewers(user.id);
        setInterviewers(updatedInterviewers);
      }
    } catch (error) {
      console.error("Error creating interviewers:", error);
      toast({
        title: "Error",
        description: "Failed to create interviewers. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      setInterviewersLoading(false);
    }
  };


  return (
    <>
      <Card
        className={`p-0 inline-block h-40 w-36 ml-1 mr-3 rounded-xl shrink-0 overflow-hidden shadow-md ${
          isLoading ? "cursor-wait" : "cursor-pointer hover:scale-105 ease-in-out duration-300"
        }`}
        onClick={() => createInterviewers()}
      >
        <CardContent className="p-0">
          {isLoading ? (
            <div className="w-full h-20 overflow-hidden flex justify-center items-center">
              <Loader2 size={40} className="animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="w-full h-20 overflow-hidden flex justify-center items-center">
              <Plus size={40} className="text-gray-700" />
            </div>
          )}
          <p className="my-3 mx-auto text-xs text-wrap w-fit text-center px-2">
            {isLoading ? "Creating..." : "Create two Default Interviewers"}
          </p>
        </CardContent>
      </Card>
    </>
  );
}

export default CreateInterviewerButton;
