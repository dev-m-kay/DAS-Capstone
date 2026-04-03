const reviewModel = require('../models/Review');
const Submission = require('../models/Submission')

// create a review
exports.create = async (req, res) => {
    try {
        const { submissionId } = req.params
        const { rating, comment} = req.body

        // look up submission
        const submission = await Submission.findBySubmissionId( submissionId );
        if (!submission) {
            return res.status(404).json({error: "Submission not found"});
        }

        // validate rating 1-5
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({error: "Rating must be between 1 and 5"});

        }
        const review = await reviewModel.create({
            submission_id: submissionId,
            reviewer_id: req.user.id,
            rating,
            comment
        });

        res.status(201).json(review);

    } catch (err) {
        // handle unique constraint (reviewer already reviewed this submission)
        if (err.code == '23505') {
            return res.status(409).json({error: "You have already reviewed this submission" })
        }
        console.error(err);
        res.status(500).json({error: "Something went wrong"})
    }
};

// return all reviews for a submission
exports.getForSubmission = async (req, res) => {
    try {
        const reviews = await reviewModel.findBySubmission(req.params.submissionId);
        res.json(reviews);        
    } catch (err) {
        console.error(err);
        res.status(500).json({error: "Something went wrong"})
    }
}

// return all reviews by the logged-in reviewer
exports.getMyReviews = async (req, res) => {
    try {
        const reviews = await reviewModel.findByReviewer(req.user.id);
        res.json(reviews);
    } catch (err) {
        console.error(err);
        res.status(500).json({error: "Something went wrong"});
    }
};


// Update own review only
exports.update = async (req, res) => {
    try {
        const{id} = req.params;
        const{rating, comment} = req.body;

        // look up the review
        const review = await reviewModel.findById(id)
        if (!review) {
            return res.status(404).json({error: "Review not found"});
        }

        // verify this reviewer owns this reviews
        if (review.reviewer_id != req.user.id) {
            return res.status(403).json({error: "You can only edit your own reviews"});
        }

        // validate rating if given
        if (rating !== undefined && (rating < 1 || rating > 5)) {
            return res.status(400).json({error: "Rating must be between 1 and 5"});
        }

        const updated = await reviewModel.update(id, {rating, comment});
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({error: "Something went wrong"});
    }
};

