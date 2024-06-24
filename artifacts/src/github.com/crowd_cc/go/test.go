package main

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"github.com/hyperledger/fabric/common/flogging"
)

type CrowdfundingContract struct {
	contractapi.Contract
}

var logger = flogging.MustGetLogger("crowdfunding_contract")

type Project struct {
	ProjectID        string  `json:"projectId"`
	Title            string  `json:"title"`
	Description      string  `json:"description"`
	ShortDescription string  `json:"shortDescription"`
	GoalAmount       float64 `json:"goalAmount"`
	CurrentAmount    float64 `json:"currentAmount"`
	IsClosed         bool    `json:"isClosed"`
}

type Contribution struct {
	ProjectID     string  `json:"projectId"`
	ContributorID string  `json:"contributorId"`
	Amount        float64 `json:"amount"`
}

type Reward struct {
	ProjectID         string  `json:"projectId"`
	RewardLevel       string  `json:"rewardLevel"`
	RewardDescription string  `json:"rewardDescription"`
	MinContribution   float64 `json:"minContribution"`
}

type User struct {
	UserID string `json:"userId"`
	Role   string `json:"role"`
}

// CreateProject creates a new project for crowdfunding
func (c *CrowdfundingContract) CreateProject(ctx contractapi.TransactionContextInterface, projectId, title, description, shortDescription string, goalAmount float64) error {
	project := Project{
		ProjectID:        projectId,
		Title:            title,
		Description:      description,
		ShortDescription: shortDescription,
		GoalAmount:       goalAmount,
		CurrentAmount:    0,
		IsClosed:         false,
	}

	projectJSON, err := json.Marshal(project)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState(projectId, projectJSON)
}

// Contribute adds a user's contribution to a project
func (c *CrowdfundingContract) Contribute(ctx contractapi.TransactionContextInterface, projectId, contributorId string, amount float64) error {
	projectJSON, err := ctx.GetStub().GetState(projectId)
	if err != nil || projectJSON == nil {
		return fmt.Errorf("Failed to find project: %s", projectId)
	}

	project := new(Project)
	err = json.Unmarshal(projectJSON, project)
	if err != nil {
		return err
	}

	project.CurrentAmount += amount

	contribution := Contribution{
		ProjectID:     projectId,
		ContributorID: contributorId,
		Amount:        amount,
	}

	contributionKey := fmt.Sprintf("%s_%s", projectId, contributorId)
	contributionJSON, err := json.Marshal(contribution)
	if err != nil {
		return err
	}

	err = ctx.GetStub().PutState(contributionKey, contributionJSON)
	if err != nil {
		return err
	}

	updatedProjectJSON, err := json.Marshal(project)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState(projectId, updatedProjectJSON)
}

// DistributeRewards distributes rewards to contributors once the project is closed
func (cc *CrowdfundingContract) DistributeRewards(ctx contractapi.TransactionContextInterface, projectID string) error {
	projectJSON, err := ctx.GetStub().GetState(projectID)
	if err != nil {
		return fmt.Errorf("failed to read project: %v", err)
	}
	if projectJSON == nil {
		return fmt.Errorf("project does not exist: %s", projectID)
	}

	var project Project
	err = json.Unmarshal(projectJSON, &project)
	if err != nil {
		return fmt.Errorf("failed to unmarshal project: %v", err)
	}

	if project.CurrentAmount < project.GoalAmount {
		return fmt.Errorf("goal amount not reached")
	}

	if project.IsClosed {
		return fmt.Errorf("project is already closed")
	}

	project.IsClosed = true
	projectJSON, err = json.Marshal(project)
	if err != nil {
		return fmt.Errorf("failed to marshal project: %v", err)
	}

	err = ctx.GetStub().PutState(projectID, projectJSON)
	if err != nil {
		return fmt.Errorf("failed to update project: %v", err)
	}

	resultsIterator, err := ctx.GetStub().GetStateByPartialCompositeKey("Contribution", []string{projectID})
	if err != nil {
		return fmt.Errorf("failed to get contributions: %v", err)
	}
	defer resultsIterator.Close()

	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return err
		}

		var contribution Contribution
		err = json.Unmarshal(queryResponse.Value, &contribution)
		if err != nil {
			return fmt.Errorf("failed to unmarshal contribution: %v", err)
		}
	}

	return nil
}

// RegisterUser registers a new user with a given role
func (c *CrowdfundingContract) RegisterUser(ctx contractapi.TransactionContextInterface, userId, role string) error {
	user := User{
		UserID: userId,
		Role:   role,
	}

	userJSON, err := json.Marshal(user)
	if err != nil {
		return err
	}

	return ctx.GetStub().PutState(userId, userJSON)
}

// GetContributionsByUser returns all contributions made by a user
func (cc *CrowdfundingContract) GetContributionsByUser(ctx contractapi.TransactionContextInterface, userId string) ([]Contribution, error) {
	queryString := fmt.Sprintf(`{"selector":{"contributorId":"%s"}}`, userId)
	resultsIterator, err := ctx.GetStub().GetQueryResult(queryString)
	if err != nil {
		return nil, fmt.Errorf("failed to get query result: %v", err)
	}
	defer resultsIterator.Close()

	var contributions []Contribution
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		var contribution Contribution
		err = json.Unmarshal(queryResponse.Value, &contribution)
		if err != nil {
			return nil, err
		}
		contributions = append(contributions, contribution)
	}

	return contributions, nil
}

// GetContributionsForCampaign returns all contributions made to a specific campaign
func (cc *CrowdfundingContract) GetContributionsForCampaign(ctx contractapi.TransactionContextInterface, campaignId string) ([]Contribution, error) {
	queryString := fmt.Sprintf(`{"selector":{"projectId":"%s"}}`, campaignId)
	resultsIterator, err := ctx.GetStub().GetQueryResult(queryString)
	if err != nil {
		return nil, fmt.Errorf("failed to get query result: %v", err)
	}
	defer resultsIterator.Close()

	var contributions []Contribution
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return nil, err
		}

		var contribution Contribution
		err = json.Unmarshal(queryResponse.Value, &contribution)
		if err != nil {
			return nil, err
		}
		contributions = append(contributions, contribution)
	}

	return contributions, nil
}

func main() {
	chaincode, err := contractapi.NewChaincode(&CrowdfundingContract{})
	if err != nil {
		fmt.Printf("Error creating crowdfunding chaincode: %s", err)
		logger.Errorf("Error creating crowdfunding chaincode: %s", err)
		return
	}

	if err := chaincode.Start(); err != nil {
		fmt.Printf("Error starting crowdfunding chaincode: %s", err)
		logger.Errorf("Error starting crowdfunding chaincode: %s", err)
	}
}
