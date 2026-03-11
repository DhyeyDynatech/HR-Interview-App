import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/contexts/auth.context";
import { InterviewBase, Question } from "@/types/interview";
import { useInterviews } from "@/contexts/interviews.context";
import { ScrollArea } from "@/components/ui/scroll-area";
import QuestionCard from "@/components/dashboard/interview/create-popup/questionCard";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { ChevronLeft } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  interviewData: InterviewBase;
  setProceed: (proceed: boolean) => void;
  setOpen: (open: boolean) => void;
}

function QuestionsPopup({ interviewData, setProceed, setOpen }: Props) {
  const { user } = useAuth();
  const [isClicked, setIsClicked] = useState(false);

  const [questions, setQuestions] = useState<Question[]>(
    interviewData.questions,
  );
  const [description, setDescription] = useState<string>(
    interviewData.description.trim(),
  );
  const { fetchInterviews } = useInterviews();

  const endOfListRef = useRef<HTMLDivElement>(null);
  const prevQuestionLengthRef = useRef(questions.length);

  function handleInputChange(id: string, newQuestion: Question) {
    setQuestions(
      questions.map((question) =>
        question.id === id ? { ...question, ...newQuestion } : question,
      ),
    );
  };

  function handleDeleteQuestion(id: string) {
    if (questions.length === 1) {
      setQuestions(
        questions.map((question) => ({
          ...question,
          question: "",
          follow_up_count: 1,
        })),
      );

      return;
    }
    setQuestions(questions.filter((question) => question.id !== id));
  };

  function handleAddQuestion() {
    if (questions.length < interviewData.question_count) {
      setQuestions([
        ...questions,
        { id: uuidv4(), question: "", follow_up_count: 1 },
      ]);
    }
  };

  const onSave = async () => {
    setIsClicked(true);
    try {
      interviewData.user_id = user?.id || "";

      interviewData.questions = questions;
      interviewData.description = description;

      // Convert BigInts to strings if necessary
      const { organization_id, ...restInterviewData } = interviewData;
      const sanitizedInterviewData = {
        ...restInterviewData,
        interviewer_id: interviewData.interviewer_id.toString(),
        response_count: interviewData.response_count.toString(),
        logo_url: user?.avatar_url || "",
      };

      // Get token for authentication
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      
      const response = await axios.post("/api/create-interview", {
        organizationName: "",
        interviewData: sanitizedInterviewData,
      }, {
        headers: token ? {
          'Authorization': `Bearer ${token}`
        } : {}
      });
      setIsClicked(false);
      fetchInterviews();
      setOpen(false);
    } catch (error) {
      console.error("Error creating interview:", error);
      setIsClicked(false);
    }
  };

  useEffect(() => {
    if (questions.length > prevQuestionLengthRef.current) {
      endOfListRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevQuestionLengthRef.current = questions.length;
  }, [questions.length]);


  return (
    <div className="text-center w-[38rem] max-h-[85vh] flex flex-col">
      <div className="flex flex-row justify-between items-center mb-4 flex-shrink-0">
        <Button
          variant="ghost"
          onClick={() => setProceed(false)}
          className="flex items-center gap-1 p-1 h-auto hover:bg-transparent"
        >
          <ChevronLeft className="h-5 w-5" />
          <span className="text-sm">Back</span>
        </Button>
        <h1 className="text-xl font-semibold">Add Questions</h1>
        <div className="w-16" /> {/* Spacer for centering */}
      </div>

      <div className="flex flex-col justify-center items-start mt-4 ml-10 mr-8 flex-1 overflow-y-auto min-h-0">
        <div className="w-full mb-4 flex-shrink-0">
          <h3 className="text-sm font-medium mb-2 text-left">Description:</h3>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full min-h-[80px] max-h-[120px] resize-none border-gray-300 focus:border-indigo-500"
            placeholder="Enter interview description..."
          />
        </div>

        <div className="w-full flex-1 overflow-y-auto min-h-0 pr-4">
          <div className="space-y-0">
            {questions.map((question, index) => (
              <QuestionCard
                key={question.id}
                questionNumber={index + 1}
                questionData={question}
                onQuestionChange={handleInputChange}
                onDelete={handleDeleteQuestion}
              />
            ))}
            <div ref={endOfListRef} />
          </div>
        </div>

        <div className="flex flex-row w-full justify-between items-center mt-4 pt-4 border-t flex-shrink-0">
          <Button
            variant="outline"
            onClick={handleAddQuestion}
            disabled={questions.length >= interviewData.question_count}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Question
          </Button>
          <Button
            onClick={onSave}
            disabled={isClicked || questions.some((q) => !q.question.trim())}
            className="bg-indigo-600 hover:bg-indigo-800 w-40"
          >
            {isClicked ? "Saving..." : "Save Interview"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default QuestionsPopup;
