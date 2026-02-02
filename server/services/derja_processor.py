import sys
import json
import os
from datasets import load_dataset
from rapidfuzz import process, fuzz

class DerjaProcessor:
    def __init__(self):
        print("Loading Derja dataset...", file=sys.stderr)
        try:
            # achermiti/derja usually has 'train' split
            self.dataset = load_dataset("achermiti/derja", split='train')
            self.tunisian_sentences = self.dataset['tn']
            self.english_sentences = self.dataset['en']
            print(f"Loaded {len(self.tunisian_sentences)} sentences.", file=sys.stderr)
        except Exception as e:
            print(f"Error loading dataset: {e}", file=sys.stderr)
            self.tunisian_sentences = []
            self.english_sentences = []

    def get_correction(self, raw_text, threshold=85):
        if not self.tunisian_sentences:
            return None
        
        # Simple fuzzy match
        match = process.extractOne(raw_text, self.tunisian_sentences, scorer=fuzz.WRatio)
        if match and match[1] >= threshold:
            index = match[2]
            return {
                "corrected": self.tunisian_sentences[index],
                "english": self.english_sentences[index],
                "score": match[1]
            }
        return None

    def get_examples(self, text, n=3):
        if not self.tunisian_sentences:
            return []
        
        matches = process.extract(text, self.tunisian_sentences, limit=n, scorer=fuzz.WRatio)
        examples = []
        for m in matches:
            index = m[2]
            examples.append({
                "tn": self.tunisian_sentences[index],
                "en": self.english_sentences[index]
            })
        return examples

processor = None

def main():
    global processor
    processor = DerjaProcessor()

    for line in sys.stdin:
        try:
            data = json.loads(line)
            cmd = data.get("command")
            text = data.get("text", "")

            if cmd == "correct":
                result = processor.get_correction(text)
                print(json.dumps({"status": "success", "result": result}))
            elif cmd == "examples":
                result = processor.get_examples(text)
                print(json.dumps({"status": "success", "result": result}))
            else:
                print(json.dumps({"status": "error", "message": "Unknown command"}))
            
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}))
            sys.stdout.flush()

if __name__ == "__main__":
    main()
